import { createRequire } from 'node:module'
import type BetterSqlite3 from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getProjectDb } from '../../database'
import { DraftRepository } from '../draft-repository'

vi.mock('../../database', () => ({ getProjectDb: vi.fn() }))
const require = createRequire(import.meta.url)
const Database = require('better-sqlite3') as typeof import('better-sqlite3')
let db: BetterSqlite3.Database
beforeEach(() => {
  db = new Database(':memory:')
  db.exec(`CREATE TABLE contents(id INTEGER PRIMARY KEY, body TEXT NOT NULL);
    CREATE TABLE drafts(id INTEGER PRIMARY KEY, content_id INTEGER NOT NULL, status TEXT NOT NULL,
      word_count INTEGER NOT NULL, updated_at TEXT);
    INSERT INTO contents VALUES(1, 'original');
    INSERT INTO drafts VALUES(1, 1, 'draft', 8, 'before');`)
  vi.mocked(getProjectDb).mockReturnValue(db)
})
afterEach(() => { db.close(); vi.clearAllMocks() })

describe('manual draft save atomicity', () => {
  it('rejects a stale writer without changing the winning body or metadata', () => {
    DraftRepository.updateContent(1, 'winner', 6, 'original')
    expect(() => DraftRepository.updateContent(1, 'stale', 5, 'original'))
      .toThrow(expect.objectContaining({ code: 'DRAFT_SAVE_CONFLICT' }))
    expect(db.prepare('SELECT body FROM contents WHERE id=1').get()).toEqual({ body: 'winner' })
    expect(db.prepare('SELECT word_count FROM drafts WHERE id=1').get()).toEqual({ word_count: 6 })
  })
  it('checks an empty baseline and does not confuse it with no baseline', () => {
    DraftRepository.updateContent(1, '', 0, 'original')
    DraftRepository.updateContent(1, 'after empty', 11, '')
    expect(() => DraftRepository.updateContent(1, 'stale empty', 11, ''))
      .toThrow(expect.objectContaining({ code: 'DRAFT_SAVE_CONFLICT' }))
  })
  it('rolls back the body when metadata persistence fails', () => {
    db.exec(`CREATE TRIGGER fail_metadata BEFORE UPDATE ON drafts
      BEGIN SELECT RAISE(ABORT, 'injected metadata failure'); END;`)
    expect(() => DraftRepository.updateContent(1, 'new text', 7)).toThrow('injected metadata failure')
    expect(db.prepare('SELECT body FROM contents WHERE id=1').get()).toEqual({ body: 'original' })
    expect(db.prepare('SELECT word_count,updated_at FROM drafts WHERE id=1').get())
      .toEqual({ word_count: 8, updated_at: 'before' })
  })
  it('saves empty text together with its zero count', () => {
    DraftRepository.updateContent(1, '', 0)
    expect(db.prepare('SELECT body FROM contents WHERE id=1').get()).toEqual({ body: '' })
    expect(db.prepare('SELECT word_count FROM drafts WHERE id=1').get()).toEqual({ word_count: 0 })
  })
  it('fails instead of falsely confirming a missing draft or body', () => {
    expect(() => DraftRepository.updateContent(2, 'new', 3)).toThrow('草稿不存在')
    db.prepare('DELETE FROM contents').run()
    expect(() => DraftRepository.updateContent(1, 'new', 3)).toThrow('正文记录不存在')
    expect(db.prepare('SELECT updated_at FROM drafts WHERE id=1').get()).toEqual({ updated_at: 'before' })
  })
})
