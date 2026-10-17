/** Deliberately small built-in ABI, not extension-package/1 or /2. */
export type JsonValue = null | boolean | number | string | readonly JsonValue[] | { readonly [key: string]: JsonValue }

export interface RuntimeResource {
  /** Runtime registrations/handles only. Never author data or persisted definitions. */
  dispose(): void | Promise<void>
}

export interface Cancellation {
  readonly requested: boolean
}

export interface BuiltinManifest {
  readonly id: string
  readonly dependencies?: readonly string[]
  /** Informational requests only; never interpreted as grants. */
  readonly requestedCapabilities?: readonly string[]
}

export interface BuiltinContext {
  readonly pluginId: string
  readonly generation: number
  readonly capabilities: readonly string[]
  /** Register immediately after acquiring each resource, including during preparation. */
  own(resource: RuntimeResource): void
  invoke(capability: string, input: JsonValue): Promise<JsonValue>
}

export interface BuiltinComponent {
  readonly manifest: BuiltinManifest
  activate(context: BuiltinContext): void | Promise<void>
}

/** Bound only by the trusted composition root; no raw database, filesystem or IPC API. */
export interface HostCapability {
  invoke(input: JsonValue, call: {
    readonly pluginId: string
    readonly generation: number
    readonly cancellation: Cancellation
  }): Promise<JsonValue>
}

export type CapabilityBindings = Readonly<Record<string, HostCapability>>
export type RuntimeState = 'inactive' | 'preparing' | 'active' | 'stopping'
export interface RuntimeSnapshot {
  readonly id: string
  readonly generation: number
  readonly state: RuntimeState
}
