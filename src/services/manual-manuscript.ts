import { ipc } from './ipc-client'
import { requireIpcSuccess } from './ipc-result'
import type { ProjectSessionContext } from '../shared/ipc-channels'
import { isProjectSessionCurrent } from '../components/project-session-gate'

export function parseManualChapterNumber(value: string): number {
  const number = Number(value)
  if (!/^\d+$/.test(value.trim()) || !Number.isSafeInteger(number) || number < 1) {
    throw new Error('章节号必须为正整数 / Chapter number must be a positive integer')
  }
  return number
}

/** Only inserts a new draft; never changes the finalized manuscript. */
export async function createManualManuscript(chapterNumber: number, session: ProjectSessionContext) {
  parseManualChapterNumber(String(chapterNumber))
  const assertCurrent = () => {
    if (!isProjectSessionCurrent(session)) throw new Error('项目会话已变化 / Project session changed')
  }
  assertCurrent()
  const result = requireIpcSuccess(await ipc.invokeWithProjectSession(session, 'db:draft-create', {
    chapterNumber,
    version: 1, // Legacy required wire field; the server allocates the actual version.
    source: 'write',
    content: '',
    wordCount: 0,
  }, session.projectPath), '创建空白草稿 / Create blank draft')
  assertCurrent()
  if (result.id === undefined) throw new Error('创建结果缺少草稿 ID / Missing draft ID')
  const draft = await ipc.invokeWithProjectSession(session, 'db:draft-get-meta', result.id, session.projectPath)
  assertCurrent()
  if (!draft) throw new Error('无法读取已创建的草稿 / Cannot read created draft')
  return draft
}
