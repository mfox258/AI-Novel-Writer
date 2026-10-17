import { getProjectDb } from '../database'
import { DraftRepository } from './draft-repository'
import { countDraftUnits } from '../../src/shared/draft-units'
import type { DraftSaveHistoryEntry } from '../../src/shared/draft-save-history'

function positiveId(value: number): void {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error('INVALID_DRAFT_HISTORY_ID')
}

export class DraftSaveHistoryRepository {
  /** Descending keyset pagination avoids loading every full manuscript. */
  static list(draftId: number, beforeId?: number): DraftSaveHistoryEntry[] {
    positiveId(draftId)
    if (beforeId !== undefined) positiveId(beforeId)
    const db = getProjectDb()
    if (!db) throw new Error('PROJECT_DATABASE_REQUIRED')
    return db.prepare(`SELECT id,draft_id AS draftId,created_at AS createdAt,length(body) AS characterCount
      FROM draft_save_history WHERE draft_id=? AND id<? ORDER BY id DESC LIMIT 50`)
      .all(draftId, beforeId ?? Number.MAX_SAFE_INTEGER) as DraftSaveHistoryEntry[]
  }

  static get(draftId: number, historyId: number): { body: string } {
    positiveId(draftId)
    positiveId(historyId)
    const db = getProjectDb()
    if (!db) throw new Error('PROJECT_DATABASE_REQUIRED')
    const entry = db.prepare('SELECT body FROM draft_save_history WHERE draft_id=? AND id=?')
      .get(draftId, historyId) as { body: string } | undefined
    if (!entry) throw new Error('DRAFT_SAVE_HISTORY_NOT_FOUND')
    return entry
  }

  /** Restoring always creates a new editable draft, including for finalized sources. */
  static restore(draftId: number, historyId: number): number {
    const db = getProjectDb()
    if (!db) throw new Error('PROJECT_DATABASE_REQUIRED')
    return db.transaction(() => {
      const entry = this.get(draftId, historyId)
      const draft = db.prepare('SELECT chapter_number FROM drafts WHERE id=?')
        .get(draftId) as { chapter_number: number } | undefined
      if (!draft) throw new Error('DRAFT_SAVE_HISTORY_NOT_FOUND')
      return DraftRepository.create({ chapterNumber: draft.chapter_number, source: 'rewrite',
        content: entry.body, wordCount: countDraftUnits(entry.body) }, db)
    }).immediate()
  }
}
