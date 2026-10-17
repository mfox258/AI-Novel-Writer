import { longNovelWorkbench } from '../features/long-novel/public'
import { BuiltinPluginRuntime, PluginRuntimeError } from '../platform/plugin-runtime/public'
import { validateWorkbench, type WorkbenchDefinition } from '../platform/workbench/public'

export interface WorkbenchSnapshot {
  readonly state: 'loading' | 'ready' | 'failed' | 'inactive'
  readonly workbenches: readonly WorkbenchDefinition[]
}

/** Trusted composition root. No third-party file or code loading. */
export function createWorkbenchHost(definitions: readonly WorkbenchDefinition[], supportedViews: readonly string[]) {
  const runtime = new BuiltinPluginRuntime()
  const registered = new Map<string, WorkbenchDefinition>()
  const listeners = new Set<() => void>()
  let snapshot: WorkbenchSnapshot = { state: 'loading', workbenches: [] }
  let starting: Promise<void> | undefined
  const publish = (state: WorkbenchSnapshot['state']) => {
    snapshot = Object.freeze({ state, workbenches: Object.freeze([...registered.values()]
      .filter(item => runtime.snapshot(item.id).state === 'active')) })
    listeners.forEach(listener => listener())
  }
  for (const definition of definitions) {
    validateWorkbench(definition)
    if (definition.activities.some(activity => !supportedViews.includes(activity.view))) {
      throw new Error('UNSUPPORTED_WORKBENCH_VIEW')
    }
    const copy = Object.freeze({ ...definition, label: Object.freeze({ ...definition.label }),
      activities: Object.freeze(definition.activities.map(activity => Object.freeze({ ...activity,
        label: Object.freeze({ ...activity.label }) }))) })
    runtime.register({ manifest: { id: copy.id }, activate(context) {
      for (const existing of registered.values()) {
        if (existing.activities.some(a => copy.activities.some(b => a.id === b.id || a.view === b.view))) {
          throw new Error('DUPLICATE_WORKBENCH_CONTRIBUTION')
        }
      }
      registered.set(copy.id, copy)
      context.own({ dispose() { registered.delete(copy.id) } })
    } })
  }
  return {
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener) } },
    start() {
      if (!starting) starting = runtime.activate().then(() => publish('ready'), error => {
        publish('failed')
        throw error
      })
      return starting
    },
    async stop(id: string) {
      try {
        await runtime.deactivate(id)
      } catch (error) {
        // A rejected lifecycle request did not stop anything. In particular,
        // do not replace a pending activation's loading snapshot with inactive.
        if (error instanceof PluginRuntimeError && error.code === 'cleanup-failed') {
          starting = undefined
          publish([...registered.keys()].some(key => runtime.snapshot(key).state === 'active') ? 'ready' : 'inactive')
        }
        throw error
      }
      starting = undefined
      publish([...registered.keys()].some(key => runtime.snapshot(key).state === 'active') ? 'ready' : 'inactive')
    },
  }
}

/** Transitional binding for legacy novel editor shortcuts owned by this host. */
export const legacyNovelWorkbenchId = longNovelWorkbench.id
export const workbenchHost = createWorkbenchHost([longNovelWorkbench], ['project', 'knowledge', 'characters'])
