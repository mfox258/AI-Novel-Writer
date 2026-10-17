import { describe, expect, it } from 'vitest'
import { createWorkbenchHost } from './workbench'
import type { WorkbenchDefinition } from '../platform/workbench/public'

function definition(id = 'test.novel'): WorkbenchDefinition {
  return { id, label: { zh: '小说', en: 'Novel' }, activities: [
    { id: `${id}.project`, label: { zh: '项目', en: 'Project' }, icon: 'folder', view: 'project' },
  ] }
}

describe('workbench host integration', () => {
  it('publishes only activated contributions and removes them on stop without data access', async () => {
    const host = createWorkbenchHost([definition()], ['project'])
    const events: string[] = []
    const unsubscribe = host.subscribe(() => events.push(host.getSnapshot().state))
    expect(host.getSnapshot().workbenches).toEqual([])
    const start = host.start()
    expect(host.start()).toBe(start)
    await start
    const snapshot = host.getSnapshot()
    expect(host.getSnapshot()).toBe(snapshot)
    expect(snapshot.workbenches.map(item => item.id)).toEqual(['test.novel'])
    await host.stop('test.novel')
    expect(host.getSnapshot()).toEqual({ state: 'inactive', workbenches: [] })
    expect(events).toEqual(['ready', 'inactive'])
    unsubscribe()
    await host.start()
    expect(host.getSnapshot().workbenches.map(item => item.id)).toEqual(['test.novel'])
  })

  it('keeps pending activation observable when a concurrent stop is rejected', async () => {
    const host = createWorkbenchHost([definition()], ['project'])
    const started = host.start()
    await expect(host.stop('test.novel')).rejects.toMatchObject({ code: 'busy' })
    await started
    expect(host.getSnapshot().state).toBe('ready')
    expect(host.getSnapshot().workbenches).toHaveLength(1)
  })

  it('rolls back duplicate slot contributions instead of mounting a partial workbench', async () => {
    const host = createWorkbenchHost([definition('one'), definition('two')], ['project'])
    await expect(host.start()).rejects.toMatchObject({ code: 'activation-failed' })
    expect(host.getSnapshot()).toEqual({ state: 'failed', workbenches: [] })
  })

  it('copies declarations and rejects unsupported renderers before activation', async () => {
    const input = definition()
    const host = createWorkbenchHost([input], ['project'])
    ;(input.label as { zh: string }).zh = 'modified'
    await host.start()
    expect(host.getSnapshot().workbenches[0].label.zh).toBe('小说')
    const invalid = { ...definition(), activities: [{ ...definition().activities[0], view: 'arbitrary-js' }] }
    expect(() => createWorkbenchHost([invalid], ['project'])).toThrow('UNSUPPORTED_WORKBENCH_VIEW')
  })

  it('can compose a second domain without adding its view to the platform model', async () => {
    const report: WorkbenchDefinition = { id: 'test.report', label: { zh: '报告', en: 'Report' },
      activities: [{ id: 'report.document', view: 'report-document', icon: 'book', label: { zh: '文档', en: 'Document' } }] }
    const host = createWorkbenchHost([definition(), report], ['project', 'report-document'])
    await host.start()
    expect(host.getSnapshot().workbenches.map(item => item.id)).toEqual(['test.novel', 'test.report'])
    await host.stop('test.novel')
    expect(host.getSnapshot().workbenches.map(item => item.id)).toEqual(['test.report'])
  })
})
