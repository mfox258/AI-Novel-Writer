import type Database from 'better-sqlite3'
import type { MigrationImplementation, SchemaReader } from './registry'

export const M07_DRAFT_SAVE_HISTORY_SQL = `
CREATE TABLE draft_save_history (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 draft_id INTEGER NOT NULL REFERENCES drafts(id) ON DELETE CASCADE,
 body TEXT NOT NULL,
 created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_draft_save_history_draft ON draft_save_history(draft_id,id);
INSERT INTO draft_save_history(draft_id,body)
 SELECT d.id,c.body FROM drafts d JOIN contents c ON c.id=d.content_id ORDER BY d.id;
CREATE TRIGGER draft_save_history_initial AFTER INSERT ON drafts BEGIN
 INSERT INTO draft_save_history(draft_id,body)
 SELECT NEW.id,body FROM contents WHERE id=NEW.content_id;
END;
CREATE TRIGGER draft_save_history_body AFTER UPDATE OF body ON contents
WHEN OLD.body IS NOT NEW.body BEGIN
 INSERT INTO draft_save_history(draft_id,body)
 SELECT id,NEW.body FROM drafts WHERE content_id=NEW.id;
END;
CREATE TRIGGER draft_save_history_rebind AFTER UPDATE OF content_id ON drafts
WHEN OLD.content_id IS NOT NEW.content_id BEGIN
 INSERT INTO draft_save_history(draft_id,body)
 SELECT NEW.id,body FROM contents WHERE id=NEW.content_id;
END;
CREATE TRIGGER draft_save_history_immutable BEFORE UPDATE ON draft_save_history BEGIN
 SELECT RAISE(ABORT,'DRAFT_SAVE_HISTORY_IMMUTABLE');
END;`

export function applyM07DraftSaveHistory(db: Database.Database): void {
  if (!db.inTransaction) throw new Error('DRAFT_SAVE_HISTORY_MIGRATION_TRANSACTION_REQUIRED')
  db.exec(M07_DRAFT_SAVE_HISTORY_SQL)
}

export function verifyM07DraftSaveHistory(db: Database.Database): boolean {
  try {
    return !db.prepare(`SELECT 1 FROM drafts d JOIN contents c ON c.id=d.content_id
      WHERE NOT EXISTS(SELECT 1 FROM draft_save_history h WHERE h.draft_id=d.id
        AND h.id=(SELECT MAX(id) FROM draft_save_history WHERE draft_id=d.id) AND h.body=c.body)
      LIMIT 1`).get()
      && (db.pragma('foreign_key_check') as unknown[]).length === 0
  } catch { return false }
}

export function createM07Migration(deps: {
  database: (reader: SchemaReader) => Database.Database
  verifyKnownSchema: (reader: SchemaReader) => boolean
}): MigrationImplementation {
  return { id: 'M07', from: 7, to: 8, owner: 'WENYUAN',
    migrate: reader => applyM07DraftSaveHistory(deps.database(reader)),
    verify: reader => deps.verifyKnownSchema(reader) && verifyM07DraftSaveHistory(deps.database(reader)) }
}
