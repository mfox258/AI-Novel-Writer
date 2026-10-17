import { createRequire } from 'node:module'
import { createHash } from 'node:crypto'
import type BetterSqlite3 from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getProjectDb } from '../../database'
import { initializeLegacyBaselineSchema } from '../../migrations/baseline-schema'
import { getDesktopMigrationRegistry } from '../../migrations/desktop-registry'
import { createMigrationRegistry } from '../../migrations/registry'
import { migrateSchema } from '../../migrations/runner'
import { SqliteSchemaAdapter, sqliteSchemaFingerprint } from '../../migrations/sqlite-schema-adapter'
import { DraftRepository } from '../draft-repository'
import { FinalizationRepository } from '../finalization-repository'
import { DraftSaveHistoryRepository as History } from '../draft-save-history-repository'

vi.mock('../../database', () => ({ getProjectDb: vi.fn(), getCurrentProjectPath: vi.fn(() => null) }))
const Database = createRequire(import.meta.url)('better-sqlite3') as typeof import('better-sqlite3')
let db: BetterSqlite3.Database
let draft: number
beforeEach(() => {
  db = new Database(':memory:')
  db.pragma('foreign_keys=ON')
  db.transaction(() => initializeLegacyBaselineSchema(db))()
  vi.mocked(getProjectDb).mockReturnValue(db)
  migrateSchema(new SqliteSchemaAdapter(db), getDesktopMigrationRegistry(), 7)
  draft = DraftRepository.create({ chapterNumber: 2, content: '旧正文', source: 'write', wordCount: 3 })
})
afterEach(() => { db.close(); vi.clearAllMocks() })
const upgrade = () => migrateSchema(new SqliteSchemaAdapter(db), getDesktopMigrationRegistry(), 8)
const bodies = () => db.prepare('SELECT body FROM draft_save_history WHERE draft_id=? ORDER BY id').pluck().all(draft)

describe('immutable manuscript save snapshots', () => {
  it('seeds only the surviving legacy text and does not seed again on reopen', () => {
    expect(upgrade().completedSteps).toEqual(['M07'])
    expect(bodies()).toEqual(['旧正文'])
    expect(upgrade().completedSteps).toEqual([])
    expect(bodies()).toEqual(['旧正文'])
    expect(DraftRepository.getFull(draft)?.version).toBe(1)
  })
  it('rolls back failed migration together with its seed, schema and version', () => {
    const before = sqliteSchemaFingerprint(db), registry = getDesktopMigrationRegistry()
    const rejected = createMigrationRegistry(registry.implementations.map(step => step.id === 'M07'
      ? { ...step, verify: () => false } : step), registry.recognizedSchemas)
    expect(() => migrateSchema(new SqliteSchemaAdapter(db), rejected, 8)).toThrow('MIGRATION_VERIFICATION_FAILED')
    expect(db.pragma('user_version', { simple: true })).toBe(7)
    expect(sqliteSchemaFingerprint(db)).toBe(before)
    expect(DraftRepository.getFull(draft)?.content).toBe('旧正文')
  })
  it('captures all body writers and empty text, while unchanged saves add no duplicate', () => {
    upgrade()
    DraftRepository.updateContent(draft, '', 0, '旧正文')
    DraftRepository.updateContent(draft, '', 0, '')
    db.prepare('UPDATE contents SET body=? WHERE id=(SELECT content_id FROM drafts WHERE id=?)').run('合并正文', draft)
    expect(bodies()).toEqual(['旧正文', '', '合并正文'])
    expect(() => db.prepare('UPDATE draft_save_history SET body=?').run('篡改')).toThrow('DRAFT_SAVE_HISTORY_IMMUTABLE')
  })
  it('does not append history for a failed or conflicting save', () => {
    upgrade()
    expect(() => DraftRepository.updateContent(draft, '过期', 2, 'wrong')).toThrow('正文已变化')
    db.exec(`CREATE TRIGGER fail_metadata BEFORE UPDATE ON drafts BEGIN SELECT RAISE(ABORT,'metadata failed'); END;`)
    expect(() => DraftRepository.updateContent(draft, '失败', 2, '旧正文')).toThrow('metadata failed')
    expect(bodies()).toEqual(['旧正文'])
    expect(DraftRepository.getFull(draft)?.content).toBe('旧正文')
  })
  it('records a draft body rebind without changing earlier snapshots', () => {
    upgrade()
    const id = db.prepare('INSERT INTO contents(body) VALUES(?)').run('重新绑定正文').lastInsertRowid
    db.prepare('UPDATE drafts SET content_id=? WHERE id=?').run(id, draft)
    expect(bodies()).toEqual(['旧正文', '重新绑定正文'])
  })
  it('fails the body write if its snapshot cannot be persisted', () => {
    upgrade()
    db.exec(`CREATE TRIGGER fail_history BEFORE INSERT ON draft_save_history BEGIN SELECT RAISE(ABORT,'history failed'); END;`)
    expect(() => DraftRepository.updateContent(draft, '失败', 2, '旧正文')).toThrow('history failed')
    expect(DraftRepository.getFull(draft)?.content).toBe('旧正文')
  })
  it('restores an empty snapshot from a finalized draft into a new editable draft', () => {
    upgrade()
    DraftRepository.updateContent(draft, '', 0, '旧正文')
    const emptyId = History.list(draft)[0].id
    DraftRepository.updateContent(draft, '最终正文', 4, '')
    FinalizationRepository.commit({ finalizationId: 'history-test-finalization', draftId: draft,
      chapterNumber: 2, chapterTitle: '第二章', content: '最终正文',
      contentHash: createHash('sha256').update('最终正文').digest('hex'), contentRevision: 1,
      targetFileName: '第二章.txt' })
    const restored = History.restore(draft, emptyId)
    expect(DraftRepository.getFull(restored)).toMatchObject({ content: '', status: 'draft', version: 2, wordCount: 0 })
    expect(DraftRepository.getFull(draft)).toMatchObject({ content: '最终正文', status: 'finalized', version: 1 })
    expect(History.get(restored, History.list(restored)[0].id)).toEqual({ body: '' })
    expect(() => History.get(restored, emptyId)).toThrow('DRAFT_SAVE_HISTORY_NOT_FOUND')
  })
  it('pages old snapshots without duplicates and removes history with an explicitly deleted draft', () => {
    upgrade()
    db.transaction(() => { for (let i = 0; i < 53; i++) DraftRepository.updateContent(draft, String(i), 1) })()
    const first = History.list(draft), second = History.list(draft, first.at(-1)!.id)
    expect(first).toHaveLength(50)
    expect(second).toHaveLength(4)
    expect(new Set([...first, ...second].map(row => row.id)).size).toBe(54)
    DraftRepository.delete(draft)
    expect(History.list(draft)).toEqual([])
  })
})
