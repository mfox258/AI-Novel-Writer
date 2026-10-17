import { createRequire } from 'node:module'
import { mkdtempSync, rmdirSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type BetterSqlite3 from 'better-sqlite3'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { initializeLegacyBaselineSchema } from '../../migrations/baseline-schema'
import { getProjectDb } from '../../database'
import { DraftRepository } from '../draft-repository'

vi.mock('../../database', () => ({ getProjectDb: vi.fn() }))
const require = createRequire(import.meta.url)
const Database = require('better-sqlite3') as typeof import('better-sqlite3')
let db: BetterSqlite3.Database | undefined
let directory: string | undefined
let file: string | undefined
afterEach(() => {
  db?.close()
  if (file) unlinkSync(file)
  if (directory) rmdirSync(directory)
  db = undefined; file = undefined; directory = undefined
  vi.clearAllMocks()
})

describe('manual manuscript SQLite round trip', () => {
  it('persists a blueprint-free chapter across reopen and restores empty text as a new draft', () => {
    directory = mkdtempSync(join(tmpdir(), 'wenyuan-manual-'))
    file = join(directory, 'project.sqlite')
    db = new Database(file)
    db.pragma('foreign_keys = ON')
    const initializing = db
    initializing.transaction(() => initializeLegacyBaselineSchema(initializing))()
    vi.mocked(getProjectDb).mockReturnValue(db)
    const original = DraftRepository.create({ chapterNumber: 2, source: 'write', content: '', wordCount: 0 })
    const next = DraftRepository.create({ chapterNumber: 2, source: 'rewrite', content: '后续正文', wordCount: 4 })
    DraftRepository.updateContent(next, '人工保存后的正文', 8)
    db.close()
    db = new Database(file, { fileMustExist: true })
    db.pragma('foreign_keys = ON')
    vi.mocked(getProjectDb).mockReturnValue(db)
    expect(db.prepare('SELECT count(*) AS count FROM blueprints').get()).toEqual({ count: 0 })
    expect(DraftRepository.getFull(next)?.content).toBe('人工保存后的正文')
    const empty = DraftRepository.getFull(original)!
    expect(empty.content).toBe('')
    const restored = DraftRepository.create({ chapterNumber: 2, source: 'rewrite', content: empty.content, wordCount: 0 })
    expect(DraftRepository.listByChapter(2).map(draft => draft.version)).toEqual([1, 2, 3])
    expect(DraftRepository.getFull(restored)?.content).toBe('')
    expect(DraftRepository.getFull(next)?.content).toBe('人工保存后的正文')
  })
})
