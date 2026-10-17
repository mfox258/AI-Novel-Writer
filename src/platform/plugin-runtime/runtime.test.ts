import { describe, expect, it } from 'vitest'
import type { BuiltinContext, Cancellation } from '../contracts/public'
import { BuiltinPluginRuntime } from './public'

describe('trusted built-in runtime', () => {
  it('rejects duplicates, missing dependencies and cycles before activation', async () => {
    let activated = false
    const runtime = new BuiltinPluginRuntime()
    runtime.register({ manifest: { id: 'a', dependencies: ['b'] }, activate() { activated = true } })
    expect(() => runtime.register({ manifest: { id: 'a' }, activate() {} })).toThrow('Duplicate component')
    await expect(runtime.activate()).rejects.toMatchObject({ code: 'missing-dependency' })
    runtime.register({ manifest: { id: 'b', dependencies: ['a'] }, activate() {} })
    await expect(runtime.activate()).rejects.toMatchObject({ code: 'cycle' })
    expect(activated).toBe(false)
  })

  it('prepares in topology order and publishes the whole batch together', async () => {
    const runtime = new BuiltinPluginRuntime()
    const events: string[] = []
    runtime.register({ manifest: { id: 'consumer', dependencies: ['provider'] }, activate() {
      events.push('consumer')
      expect(runtime.snapshot('provider').state).toBe('preparing')
    } })
    runtime.register({ manifest: { id: 'provider' }, async activate(ctx) {
      events.push('provider')
      await expect(ctx.invoke('query', null)).rejects.toMatchObject({ code: 'closed' })
    } })
    await runtime.activate(['consumer'])
    expect(events).toEqual(['provider', 'consumer'])
    expect(runtime.snapshot('provider').state).toBe('active')
    expect(runtime.snapshot('consumer').state).toBe('active')
  })

  it('rolls back all newly prepared resources in reverse order despite cleanup errors', async () => {
    const runtime = new BuiltinPluginRuntime()
    const released: string[] = []
    runtime.register({ manifest: { id: 'existing' }, activate(ctx) {
      ctx.own({ dispose() { released.push('existing') } })
    } })
    await runtime.activate(['existing'])
    runtime.register({ manifest: { id: 'a' }, activate(ctx) {
      ctx.own({ dispose() { released.push('a1') } })
      ctx.own({ dispose() { released.push('a2'); throw Error('cleanup') } })
    } })
    runtime.register({ manifest: { id: 'b', dependencies: ['a'] }, activate(ctx) {
      ctx.own({ dispose() { released.push('b') } })
      throw Error('prepare')
    } })
    await expect(runtime.activate()).rejects.toMatchObject({ code: 'activation-failed', causes: expect.any(Array) })
    expect(released).toEqual(['b', 'a2', 'a1'])
    expect(runtime.snapshot('existing').state).toBe('active')
    expect(runtime.snapshot('a').state).toBe('inactive')
    expect(runtime.snapshot('b').state).toBe('inactive')
  })

  it('does not turn manifest requests into capability grants or expose host objects', async () => {
    let context!: BuiltinContext
    const runtime = new BuiltinPluginRuntime()
    runtime.register({ manifest: { id: 'a', requestedCapabilities: ['fs', 'db', 'IPC'] }, activate(ctx) { context = ctx } }, {
      echo: { async invoke(input) { return input } },
    })
    await runtime.activate()
    expect(Object.keys(context).sort()).toEqual(['capabilities', 'generation', 'invoke', 'own', 'pluginId'])
    expect(context.capabilities).toEqual(['echo'])
    await expect(context.invoke('fs', null)).rejects.toMatchObject({ code: 'unavailable-capability' })
    await expect(context.invoke('echo', { value: 1 })).resolves.toEqual({ value: 1 })
  })

  it('rejects dependent stop by default; cascade closes every gate before reverse cleanup', async () => {
    const runtime = new BuiltinPluginRuntime()
    const events: string[] = []
    const contexts: BuiltinContext[] = []
    for (const id of ['a', 'b']) runtime.register({
      manifest: { id, dependencies: id === 'b' ? ['a'] : [] },
      activate(ctx) {
        contexts.push(ctx)
        ctx.own({ async dispose() {
          expect(runtime.snapshot('a').state).toBe('stopping')
          for (const context of contexts) await expect(context.invoke('echo', null)).rejects.toMatchObject({ code: 'closed' })
          events.push(id)
        } })
      },
    })
    await runtime.activate()
    await expect(runtime.deactivate('a')).rejects.toMatchObject({ code: 'active-dependent' })
    expect(runtime.snapshot('a').state).toBe('active')
    await runtime.deactivate('a', 'cascade')
    expect(events).toEqual(['b', 'a'])
    await runtime.deactivate('a')
    expect(events).toEqual(['b', 'a'])
  })

  it('cancels in-flight calls and rejects old results and contexts after reactivation', async () => {
    const runtime = new BuiltinPluginRuntime()
    let context!: BuiltinContext
    let finish!: (value: null) => void
    let cancellation!: Cancellation
    runtime.register({ manifest: { id: 'a' }, activate(ctx) { context = ctx } }, {
      slow: { invoke(_input, call) {
        cancellation = call.cancellation
        return new Promise(resolve => { finish = resolve })
      } },
    })
    await runtime.activate()
    const previous = context
    const result = context.invoke('slow', null)
    const rejected = expect(result).rejects.toMatchObject({ code: 'stale-result' })
    await runtime.deactivate('a')
    expect(cancellation.requested).toBe(true)
    await runtime.activate()
    expect(context.generation).toBeGreaterThan(previous.generation)
    finish(null)
    await rejected
    await expect(previous.invoke('slow', null)).rejects.toMatchObject({ code: 'closed' })
    expect(() => previous.own({ dispose() {} })).toThrow('closed')
  })

  it('rejects concurrent lifecycle mutation and remains reusable after cleanup failure', async () => {
    const runtime = new BuiltinPluginRuntime()
    let finish!: () => void
    runtime.register({ manifest: { id: 'a' }, async activate(ctx) {
      ctx.own({ dispose() { throw Error('dispose') } })
      await new Promise<void>(resolve => { finish = resolve })
    } })
    const activation = runtime.activate()
    await expect(runtime.deactivate('a')).rejects.toMatchObject({ code: 'busy' })
    expect(() => runtime.register({ manifest: { id: 'b' }, activate() {} })).toThrow('progress')
    finish()
    await activation
    await expect(runtime.deactivate('a')).rejects.toMatchObject({ code: 'cleanup-failed' })
    expect(runtime.snapshot('a').state).toBe('inactive')
    await runtime.deactivate('a')
  })
})
