import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ invoke: vi.fn(), current: true }))
vi.mock('./ipc-client', () => ({ ipc: { invokeWithProjectSession: mocks.invoke, invoke: mocks.invoke } }))
vi.mock('../stores/project-store', () => ({ useProjectStore: { getState: () => ({ currentProject: null }) } }))
vi.mock('../components/project-session-gate', () => ({
  isProjectSessionCurrent: () => mocks.current,
  captureProjectSession: () => null,
  isProjectSessionPath: (session: { projectPath: string }, path: string) => session.projectPath === path,
}))
import { createManualManuscript, parseManualChapterNumber } from './manual-manuscript'
import { getChapters, getVersionContent, getChapterLatestContent, revertToVersion } from './version-service'

const session = { projectId: 'project', leaseId: 'lease', projectPath: 'D:/novel' }
beforeEach(() => { mocks.invoke.mockReset(); mocks.current = true })

describe('manual manuscript', () => {
  it.each(['', '0', '-1', '1.5', '1e2', 'Infinity', '9007199254740992', 'abc'])('rejects invalid chapter %s', value => {
    expect(() => parseManualChapterNumber(value)).toThrow()
  })
  it('accepts a positive chapter number', () => {
    expect(parseManualChapterNumber(' 12 ')).toBe(12)
  })
  it('creates empty text through the frozen session and reads the server version', async () => {
    mocks.invoke.mockResolvedValueOnce({ success: true, id: 7 })
      .mockResolvedValueOnce({ id: 7, chapterNumber: 3, version: 8, status: 'draft' })
    expect(await createManualManuscript(3, session)).toMatchObject({ id: 7, version: 8 })
    expect(mocks.invoke.mock.calls).toEqual([
      [session, 'db:draft-create', { chapterNumber: 3, version: 1, source: 'write', content: '', wordCount: 0 }, session.projectPath],
      [session, 'db:draft-get-meta', 7, session.projectPath],
    ])
  })
  it('rejects a stale session before IPC', async () => {
    mocks.current = false
    await expect(createManualManuscript(1, session)).rejects.toThrow()
    expect(mocks.invoke).not.toHaveBeenCalled()
  })
  it('stops after creation if the project is reopened with another lease', async () => {
    mocks.invoke.mockImplementationOnce(async () => {
      mocks.current = false
      return { success: true, id: 7 }
    })
    await expect(createManualManuscript(1, session)).rejects.toThrow()
    expect(mocks.invoke).toHaveBeenCalledTimes(1)
  })
  it('propagates database failure without reading or changing existing drafts', async () => {
    mocks.invoke.mockResolvedValueOnce({ success: false, error: 'database failed' })
    await expect(createManualManuscript(1, session)).rejects.toThrow('database failed')
    expect(mocks.invoke).toHaveBeenCalledTimes(1)
  })
  it('enumerates draft-only chapters and deduplicates blueprint chapters in numeric order', async () => {
    mocks.invoke.mockResolvedValueOnce([{ chapterNumber: 10, title: 'Blueprint' }])
      .mockResolvedValueOnce([
        { chapterNumber: 2, version: 1, status: 'draft', chapterTitle: 'Manual', createdAt: 'now' },
        { chapterNumber: 10, version: 1, status: 'draft', createdAt: 'now' },
      ])
    const chapters = await getChapters(session.projectPath, session)
    expect(chapters.map(c => [c.chapter_number, c.file_name])).toEqual([[2, 'Manual'], [10, 'Blueprint']])
    expect(mocks.invoke.mock.calls.every(call => call[0] === session)).toBe(true)
  })
  it('preserves empty historical and current content', async () => {
    mocks.invoke.mockResolvedValueOnce({ content: '' })
    expect(await getVersionContent(1, session.projectPath)).toBe('')
    mocks.invoke.mockResolvedValueOnce({ id: 1 }).mockResolvedValueOnce({ content: '' })
    expect(await getChapterLatestContent(1, session.projectPath)).toBe('')
  })
  it('restores an empty draft without requesting a next version', async () => {
    mocks.invoke.mockResolvedValueOnce({ success: true, id: 9 })
    expect(await revertToVersion(1, '', session.projectPath)).toBe(true)
    expect(mocks.invoke).toHaveBeenCalledTimes(1)
    expect(mocks.invoke).toHaveBeenCalledWith('db:draft-create', expect.objectContaining({ content: '', wordCount: 0 }), session.projectPath)
  })
})
