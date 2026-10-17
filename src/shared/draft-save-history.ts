/** Save snapshots are independent of draft/rewrite version numbers. */
export interface DraftSaveHistoryEntry {
  id: number
  draftId: number
  createdAt: string
  characterCount: number
}
