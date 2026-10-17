import type { ProjectSessionContext } from '../shared/ipc-channels'
import { captureProjectSession, isProjectSessionCurrent, isProjectSessionPath } from '../components/project-session-gate'
import { useProjectStore } from '../stores/project-store'
/**
 * version-service — 版本历史数据访问服务
 *
 * 封装 VersionHistory 中的所有 IPC 调用，
 * 避免组件直接与 IPC 通信。
 */

import { ipc } from './ipc-client'
import { requireIpcSuccess } from './ipc-result'
import { countDraftUnits } from '../shared/draft-units'

/** 章节元数据（从数据库返回） */
export interface ChapterRecord {
  chapter_id: string
  file_path: string
  file_name: string
  updated_at: string
  chapter_number: number
  status: string
}

/** 版本记录 */
export interface VersionRecord {
  id: number
  version: number
  type: string
  word_count: number
  created_at: string
  dependencies_stale: boolean
}

/** 合并蓝图和草稿章节，包括不依赖蓝图的手写章节。 */
export async function getChapters(expectedProjectPath: string, expectedSession?: ProjectSessionContext): Promise<ChapterRecord[]> {
  const session = expectedSession ?? captureProjectSession(useProjectStore.getState().currentProject)
  if (!session || !isProjectSessionPath(session, expectedProjectPath) || !isProjectSessionCurrent(session)) return []
  const [blueprints, drafts] = await Promise.all([
    ipc.invokeWithProjectSession(session, 'db:blueprint-get-all', expectedProjectPath),
    ipc.invokeWithProjectSession(session, 'db:draft-list-all', expectedProjectPath),
  ])
  if (!isProjectSessionCurrent(session)) return []
  const chapters = new Map<number, ChapterRecord>()
  for (const draft of [...drafts].sort((a, b) => a.version - b.version)) {
    chapters.set(draft.chapterNumber, {
      chapter_id: String(draft.chapterNumber), chapter_number: draft.chapterNumber,
      file_path: '', file_name: draft.chapterTitle || '',
      updated_at: draft.createdAt, status: draft.status,
    })
  }
  for (const bp of blueprints) {
    const prior = chapters.get(bp.chapterNumber)
    chapters.set(bp.chapterNumber, {
      chapter_id: String(bp.chapterNumber), chapter_number: bp.chapterNumber,
      file_path: '', file_name: bp.title || prior?.file_name || '',
      updated_at: prior?.updated_at ?? '', status: prior?.status ?? 'draft',
    })
  }
  return [...chapters.values()].sort((a, b) => a.chapter_number - b.chapter_number)
}

/** 获取章节的版本列表 (草稿列表) */
export async function getChapterVersions(chapterId: string, expectedProjectPath: string): Promise<VersionRecord[]> {
  const chapterNumber = parseInt(chapterId)
  if (isNaN(chapterNumber)) return []
  const drafts = (await ipc.invoke('db:draft-list', chapterNumber, expectedProjectPath)) as unknown as Array<Record<string, unknown>>
  return drafts.map(d => ({
    id: d.id as number,
    version: d.version as number,
    type: d.status === 'finalized' ? 'final' : (d.status === 'revised' ? 'refined' : 'draft'),
    word_count: (d.wordCount as number) || 0,
    created_at: String(d.createdAt),
    dependencies_stale: d.dependenciesStale === true,
  }))
}

/** 获取版本内容 */
export async function getVersionContent(versionId: number, expectedProjectPath: string): Promise<string | null> {
  const draft = (await ipc.invoke('db:draft-get-full', versionId, expectedProjectPath)) as { content?: string } | null
  return draft?.content ?? null
}

/** 获取章节最新内容（取代之前的文件读取） */
export async function getChapterLatestContent(chapterNumber: number, expectedProjectPath: string): Promise<string> {
  const draft = (await ipc.invoke('db:draft-get-latest', chapterNumber, expectedProjectPath)) as { id?: number } | null
  if (!draft || draft.id === undefined) return '（章节尚无内容）'
  const full = (await ipc.invoke('db:draft-get-full', draft.id, expectedProjectPath)) as { content?: string } | null
  return full?.content ?? '（内容被错误截断）'
}

/** 回退到某个历史版本，创建新草稿 */
export async function revertToVersion(chapterNumber: number, content: string, expectedProjectPath: string): Promise<boolean> {
  const res = await ipc.invoke('db:draft-create', {
    chapterNumber,
    version: 1, // Server allocates the version.
    source: 'rewrite',
    content,
    wordCount: countDraftUnits(content),
  }, expectedProjectPath)
  requireIpcSuccess(res, '创建回滚草稿')
  return true
}
