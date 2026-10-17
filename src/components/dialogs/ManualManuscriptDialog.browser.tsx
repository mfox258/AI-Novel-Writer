import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { setActiveProjectSessionContext } from '../../shared/project-session-context'
import { useProjectStore } from '../../stores/project-store'
import { useEditorStore } from '../../stores/editor-store'
import { useDraftStore } from '../../stores/draft-store'
import { useLocaleStore } from '../../stores/locale-store'
import ManualManuscriptDialog from './ManualManuscriptDialog'

const session = { projectId: 'manual-test', projectPath: 'C:/synthetic/manual', leaseId: 'lease' }
let root: Root, container: HTMLDivElement
let invoke: ReturnType<typeof vi.fn>
const originalProject = useProjectStore.getState()
const originalEditor = useEditorStore.getState()
const originalLocale = useLocaleStore.getState()
;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

beforeEach(() => {
  useLocaleStore.setState({ locale: 'zh-CN', initialized: true })
  useProjectStore.setState({ currentProject: {
    id: session.projectId, path: session.projectPath, name: 'Synthetic', sessionLease: session.leaseId, novelConfig: {},
  } as never })
  useEditorStore.setState({ tabs: [], activeTabId: null })
  setActiveProjectSessionContext(session)
  vi.spyOn(useDraftStore.getState(), 'loadChapterDrafts').mockResolvedValue(undefined)
  invoke = vi.fn(async (channel: string) => {
    if (channel === 'db:draft-create') return { success: true, id: 20 }
    if (channel === 'db:draft-get-meta') return { id: 20, chapterNumber: 1, version: 3, status: 'draft' }
    throw new Error(`Unexpected dependency: ${channel}`)
  })
  Object.defineProperty(window, 'aiNovelAPI', { configurable: true,
    value: { invoke, on: vi.fn(() => () => {}), once: vi.fn(), send: vi.fn() } })
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  Reflect.deleteProperty(window, 'aiNovelAPI')
  setActiveProjectSessionContext(null)
  useProjectStore.setState(originalProject)
  useEditorStore.setState(originalEditor)
  useLocaleStore.setState(originalLocale)
  vi.restoreAllMocks()
})

it('creates and opens an empty manuscript without model or blueprint calls', async () => {
  const close = vi.fn()
  await act(async () => root.render(<ManualManuscriptDialog session={session} onClose={close} />))
  const form = document.querySelector('form')!
  await act(async () => { form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })) })
  await vi.waitFor(() => expect(close).toHaveBeenCalledOnce())
  expect(invoke.mock.calls.map(call => call[0])).toEqual(['db:draft-create', 'db:draft-get-meta'])
  expect(useEditorStore.getState().tabs[0]).toMatchObject({
    filePath: 'ai-novel://draft/20', content: '', savedContent: '', draftStatus: 'draft',
    projectKey: session.projectPath, projectSessionLease: session.leaseId,
  })
})

it('keeps creation failures visible and does not open a phantom document', async () => {
  invoke.mockResolvedValueOnce({ success: false, error: 'Synthetic save failure' })
  const close = vi.fn()
  await act(async () => root.render(<ManualManuscriptDialog session={session} onClose={close} />))
  await act(async () => {
    document.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  })
  await vi.waitFor(() => expect(document.querySelector('[role="alert"]')?.textContent).toContain('Synthetic save failure'))
  expect(close).not.toHaveBeenCalled()
  expect(useEditorStore.getState().tabs).toEqual([])
})
