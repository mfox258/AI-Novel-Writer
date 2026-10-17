import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'
import { setActiveProjectSessionContext } from '../../../shared/project-session-context'
import { useProjectStore } from '../../../stores/project-store'
import { useEditorStore } from '../../../stores/editor-store'
import { useLocaleStore } from '../../../stores/locale-store'
import DraftSaveHistoryDialog from '../DraftSaveHistoryDialog'

const session = { projectId: 'history-test', projectPath: 'C:/synthetic/history', leaseId: 'lease' }
let root: Root, container: HTMLDivElement
let invoke: ReturnType<typeof vi.fn>
const originalProject = useProjectStore.getState(), originalEditor = useEditorStore.getState(), originalLocale = useLocaleStore.getState()
;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
beforeEach(() => {
  useLocaleStore.setState({ locale: 'zh-CN', initialized: true })
  useProjectStore.setState({ currentProject: {
    id: session.projectId, path: session.projectPath, name: 'Synthetic', sessionLease: session.leaseId, novelConfig: {},
  } as never })
  useEditorStore.setState({ tabs: [{ id: 'original', type: 'chapter', name: 'Original', content: '本地编辑',
    savedContent: '当前正文', dirty: true, projectKey: session.projectPath, projectSessionLease: session.leaseId }], activeTabId: 'original' })
  setActiveProjectSessionContext(session)
  invoke = vi.fn(async (channel: string) => {
    if (channel === 'db:draft-save-history-list') return [{ id: 2, draftId: 7, createdAt: '2026-10-17', characterCount: 0 }]
    if (channel === 'db:draft-save-history-get') return { body: '' }
    if (channel === 'db:draft-save-history-restore') return { success: true, id: 20 }
    if (channel === 'db:draft-get-full') return { id: 20, chapterNumber: 1, version: 3, content: '', status: 'draft' }
    throw new Error(`Unexpected dependency: ${channel}`)
  })
  Object.defineProperty(window, 'aiNovelAPI', { configurable: true,
    value: { invoke, on: vi.fn(() => () => {}), once: vi.fn(), send: vi.fn() } })
  container = document.createElement('div'); document.body.append(container); root = createRoot(container)
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove(); Reflect.deleteProperty(window, 'aiNovelAPI'); setActiveProjectSessionContext(null)
  useProjectStore.setState(originalProject); useEditorStore.setState(originalEditor); useLocaleStore.setState(originalLocale)
  vi.restoreAllMocks()
})
const selectEmpty = async () => {
  await act(async () => page.getByRole('button', { name: /快照 #2/ }).click())
  await expect.element(page.getByLabelText('历史正文预览')).toBeVisible()
}
it('previews and restores empty text into a new draft while keeping dirty local edits', async () => {
  const close = vi.fn()
  await act(async () => root.render(<DraftSaveHistoryDialog draftId={7} session={session} onClose={close} />))
  await selectEmpty()
  await act(async () => page.getByRole('button', { name: '恢复为新草稿' }).click())
  await vi.waitFor(() => expect(close).toHaveBeenCalledOnce())
  expect(invoke.mock.calls).toContainEqual(['db:draft-save-history-restore', 7, 2, session.projectPath, session])
  expect(useEditorStore.getState().tabs.find(tab => tab.id === 'original')).toMatchObject({ content: '本地编辑', dirty: true })
  expect(useEditorStore.getState().tabs.find(tab => tab.draftId === 20)).toMatchObject({ content: '', savedContent: '', draftStatus: 'draft' })
})
it('retains the history view and local edits when restoration fails', async () => {
  invoke.mockImplementation(async (channel: string) => {
    if (channel === 'db:draft-save-history-list') return [{ id: 2, draftId: 7, createdAt: '', characterCount: 0 }]
    if (channel === 'db:draft-save-history-get') return { body: '' }
    if (channel === 'db:draft-save-history-restore') return { success: false, error: 'disk failure' }
  })
  const close = vi.fn()
  await act(async () => root.render(<DraftSaveHistoryDialog draftId={7} session={session} onClose={close} />))
  await selectEmpty()
  await act(async () => page.getByRole('button', { name: '恢复为新草稿' }).click())
  await expect.element(page.getByRole('alert')).toHaveTextContent('disk failure')
  expect(close).not.toHaveBeenCalled()
  expect(useEditorStore.getState().tabs).toHaveLength(1)
})
it('retries opening the committed draft without creating another restored draft', async () => {
  const originalInvoke = invoke.getMockImplementation() as (channel: string, ...args: unknown[]) => unknown
  let reads = 0
  invoke.mockImplementation((channel: string, ...args: unknown[]) => {
    if (channel === 'db:draft-get-full' && ++reads === 1) throw new Error('read failed')
    return originalInvoke(channel, ...args)
  })
  const close = vi.fn()
  await act(async () => root.render(<DraftSaveHistoryDialog draftId={7} session={session} onClose={close} />))
  await selectEmpty()
  await act(async () => page.getByRole('button', { name: '恢复为新草稿' }).click())
  await expect.element(page.getByRole('alert')).toHaveTextContent('read failed')
  await act(async () => page.getByRole('button', { name: '打开已恢复草稿' }).click())
  await vi.waitFor(() => expect(close).toHaveBeenCalledOnce())
  expect(invoke.mock.calls.filter(call => call[0] === 'db:draft-save-history-restore')).toHaveLength(1)
  expect(invoke.mock.calls.filter(call => call[0] === 'db:draft-get-full')).toHaveLength(2)
})

it('ignores a late restore response after the project lease changes', async () => {
  let finish!: (value: unknown) => void
  const response = new Promise(resolve => { finish = resolve })
  const originalInvoke = invoke.getMockImplementation() as (channel: string, ...args: unknown[]) => unknown
  invoke.mockImplementation((channel: string, ...args: unknown[]) => channel === 'db:draft-save-history-restore'
    ? response : originalInvoke(channel, ...args))
  const close = vi.fn()
  await act(async () => root.render(<DraftSaveHistoryDialog draftId={7} session={session} onClose={close} />))
  await selectEmpty()
  await act(async () => page.getByRole('button', { name: '恢复为新草稿' }).click())
  setActiveProjectSessionContext({ ...session, leaseId: 'new-lease' })
  useProjectStore.setState({ currentProject: { ...useProjectStore.getState().currentProject!, sessionLease: 'new-lease' } })
  await act(async () => { finish({ success: true, id: 20 }); await response })
  expect(close).not.toHaveBeenCalled()
  expect(invoke.mock.calls.some(call => call[0] === 'db:draft-get-full')).toBe(false)
  expect(useEditorStore.getState().tabs).toHaveLength(1)
})
