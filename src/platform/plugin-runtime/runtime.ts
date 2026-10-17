import type {
  BuiltinComponent, BuiltinContext, CapabilityBindings, HostCapability,
  JsonValue, RuntimeResource, RuntimeSnapshot, RuntimeState,
} from '../contracts/public'

export type StopPolicy = 'reject-dependents' | 'cascade'
export class PluginRuntimeError extends Error {
  constructor(readonly code: string, message: string, readonly causes: readonly unknown[] = []) {
    super(message)
    this.name = 'PluginRuntimeError'
  }
}

interface Entry {
  component: BuiltinComponent
  dependencies: readonly string[]
  bindings: ReadonlyMap<string, HostCapability>
  state: RuntimeState
  generation: number
  resources: RuntimeResource[]
  calls: Set<{ requested: boolean }>
}

/** Trusted built-ins only. This is lifecycle coordination, NOT a JS sandbox. */
export class BuiltinPluginRuntime {
  private readonly entries = new Map<string, Entry>()
  private busy = false

  register(component: BuiltinComponent, bindings: CapabilityBindings = {}): void {
    this.assertIdle()
    const { id, dependencies = [] } = component.manifest
    if (!id.trim()) throw new PluginRuntimeError('invalid-id', 'Component ID must be nonempty')
    if (this.entries.has(id)) throw new PluginRuntimeError('duplicate', `Duplicate component: ${id}`)
    if (new Set(dependencies).size !== dependencies.length) {
      throw new PluginRuntimeError('duplicate-dependency', `Duplicate dependency in ${id}`)
    }
    // Copy host bindings and metadata; subsequent manifest/object mutation cannot change the graph.
    const copiedBindings = new Map<string, HostCapability>()
    for (const [name, binding] of Object.entries(bindings)) {
      copiedBindings.set(name, { invoke: binding.invoke.bind(binding) })
    }
    this.entries.set(id, {
      component: { manifest: { id }, activate: component.activate.bind(component) },
      dependencies: [...dependencies], bindings: copiedBindings,
      state: 'inactive', generation: 0, resources: [], calls: new Set(),
    })
  }

  snapshot(id: string): RuntimeSnapshot {
    const entry = this.get(id)
    return { id, generation: entry.generation, state: entry.state }
  }

  /** Validate the entire explicit registry before preparing any component. */
  order(): readonly string[] {
    const visited = new Set<string>()
    const visiting = new Set<string>()
    const result: string[] = []
    const visit = (id: string) => {
      if (visiting.has(id)) throw new PluginRuntimeError('cycle', `Dependency cycle at ${id}`)
      if (visited.has(id)) return
      const entry = this.get(id)
      visiting.add(id)
      entry.dependencies.forEach(visit)
      visiting.delete(id)
      visited.add(id)
      result.push(id)
    }
    this.entries.forEach((_, id) => visit(id))
    return result
  }

  /** Prepare the requested dependency closure, publish only after the whole batch succeeds. */
  activate(ids: readonly string[] = [...this.entries.keys()]): Promise<void> {
    return this.exclusive(async () => {
      const order = this.order()
      const wanted = new Set<string>()
      const include = (id: string) => {
        if (wanted.has(id)) return
        wanted.add(id)
        this.get(id).dependencies.forEach(include)
      }
      ids.forEach(include)
      const prepared: Entry[] = []
      try {
        for (const id of order.filter(id => wanted.has(id))) {
          const entry = this.get(id)
          if (entry.state === 'active') continue
          entry.state = 'preparing'
          entry.generation++
          prepared.push(entry)
          await entry.component.activate(this.context(id, entry))
        }
        prepared.forEach(entry => { entry.state = 'active' })
      } catch (cause) {
        this.close(prepared)
        const errors = await this.release([...prepared].reverse())
        throw new PluginRuntimeError('activation-failed', 'Activation rolled back', [cause, ...errors])
      }
    })
  }

  /** Default prevents an active dependent from losing its provider. Cascade is explicit. */
  deactivate(id: string, policy: StopPolicy = 'reject-dependents'): Promise<void> {
    return this.exclusive(async () => {
      this.get(id)
      const selected = new Set([id])
      const order = this.order()
      for (const candidate of order) {
        const entry = this.get(candidate)
        if (entry.state === 'active' && entry.dependencies.some(dep => selected.has(dep))) {
          if (policy !== 'cascade') {
            throw new PluginRuntimeError('active-dependent', `${candidate} depends on ${id}`)
          }
          selected.add(candidate)
        }
      }
      const entries = [...order].reverse().filter(key => selected.has(key))
        .map(key => this.get(key)).filter(entry => entry.state === 'active')
      this.close(entries) // All gates close synchronously, before the first disposer runs.
      const errors = await this.release(entries)
      if (errors.length) throw new PluginRuntimeError('cleanup-failed', 'Resource cleanup failed', errors)
    })
  }

  private context(id: string, entry: Entry): BuiltinContext {
    const generation = entry.generation
    return Object.freeze({
      pluginId: id, generation,
      capabilities: Object.freeze([...entry.bindings.keys()]),
      own: (resource: RuntimeResource) => {
        if (entry.generation !== generation || !['preparing', 'active'].includes(entry.state)) {
          throw new PluginRuntimeError('closed', 'Resource scope is closed')
        }
        if (entry.resources.includes(resource)) throw new PluginRuntimeError('duplicate-resource', 'Resource already owned')
        entry.resources.push(resource)
      },
      invoke: async (name: string, input: JsonValue): Promise<JsonValue> => {
        const current = () => entry.state === 'active' && entry.generation === generation
        if (!current()) throw new PluginRuntimeError('closed', 'Invocation gate is closed')
        const capability = entry.bindings.get(name)
        if (!capability) throw new PluginRuntimeError('unavailable-capability', `Capability not bound: ${name}`)
        const cancellation = { requested: false }
        entry.calls.add(cancellation)
        try {
          const result = await capability.invoke(input, { pluginId: id, generation, cancellation })
          if (!current()) throw new PluginRuntimeError('stale-result', 'Result belongs to a closed generation')
          return result
        } finally {
          entry.calls.delete(cancellation)
        }
      },
    })
  }

  private close(entries: readonly Entry[]): void {
    for (const entry of entries) {
      entry.state = 'stopping'
      entry.generation++
      entry.calls.forEach(call => { call.requested = true })
    }
  }

  private async release(entries: readonly Entry[]): Promise<unknown[]> {
    const errors: unknown[] = []
    for (const entry of entries) {
      for (const resource of entry.resources.splice(0).reverse()) {
        try { await resource.dispose() } catch (error) { errors.push(error) }
      }
      entry.state = 'inactive'
    }
    return errors
  }

  private get(id: string): Entry {
    const entry = this.entries.get(id)
    if (!entry) throw new PluginRuntimeError('missing-dependency', `Component not registered: ${id}`)
    return entry
  }

  private assertIdle(): void {
    if (this.busy) throw new PluginRuntimeError('busy', 'Lifecycle operation already in progress')
  }

  private async exclusive(action: () => Promise<void>): Promise<void> {
    this.assertIdle()
    this.busy = true
    try { await action() } finally { this.busy = false }
  }
}
