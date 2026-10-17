import { useEffect, useRef, useState } from 'react'
import type { ProjectSessionContext } from '../../shared/ipc-channels'
import type { DraftSaveHistoryEntry } from '../../shared/draft-save-history'
import { formatResourceUri } from '../../shared/project-paths'
import { globalEventBus } from '../../shared/event-bus'
import { ipc } from '../../services/ipc-client'
import { useEditorStore } from '../../stores/editor-store'
import { useLocaleStore } from '../../stores/locale-store'
import { isProjectSessionCurrent } from '../project-session-gate'
import { Button } from '../ui/Button'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '../ui/Dialog'

export default function DraftSaveHistoryDialog({ draftId, session, onClose }: {
  draftId: number; session: ProjectSessionContext; onClose: () => void
}) {
  const text = useLocaleStore(s => s.text)
  const [entries, setEntries] = useState<DraftSaveHistoryEntry[]>([])
  const [selected, setSelected] = useState<{ id: number; body: string } | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [more, setMore] = useState(false)
  const [restored, setRestored] = useState<{ historyId: number; draftId: number } | null>(null)
  const active = useRef(true)
  const pending = useRef(false)
  const request = useRef(0)
  const restoredDrafts = useRef(new Map<number, number>())
  const current = () => active.current && isProjectSessionCurrent(session)

  useEffect(() => {
    active.current = true
    void ipc.invokeWithProjectSession(session, 'db:draft-save-history-list', draftId, session.projectPath)
      .then(rows => { if (active.current && isProjectSessionCurrent(session)) { setEntries(rows); setMore(rows.length === 50) } })
      .catch(e => { if (active.current && isProjectSessionCurrent(session)) setError(String(e)) })
    return () => { active.current = false }
  }, [draftId, session])

  const preview = async (id: number) => {
    const generation = ++request.current
    setSelected(null)
    const restoredId = restoredDrafts.current.get(id)
    setRestored(restoredId === undefined ? null : { historyId: id, draftId: restoredId })
    setError('')
    try {
      const entry = await ipc.invokeWithProjectSession(session, 'db:draft-save-history-get', draftId, id, session.projectPath)
      if (current() && generation === request.current) setSelected({ id, body: entry.body })
    } catch (e) { if (current() && generation === request.current) setError(String(e)) }
  }
  const loadMore = async () => {
    if (pending.current || !entries.length) return
    pending.current = true
    setBusy(true)
    try {
      const rows = await ipc.invokeWithProjectSession(session, 'db:draft-save-history-list', draftId,
        session.projectPath, entries[entries.length - 1].id)
      if (current()) { setEntries(previous => [...previous, ...rows]); setMore(rows.length === 50) }
    } catch (e) { if (current()) setError(String(e)) }
    finally { pending.current = false; if (current()) setBusy(false) }
  }
  const restore = async () => {
    if (!selected || pending.current || !current()) return
    pending.current = true
    setBusy(true)
    setError('')
    let restoredId = restoredDrafts.current.get(selected.id)
    try {
      if (restoredId === undefined) {
        const result = await ipc.invokeWithProjectSession(session, 'db:draft-save-history-restore',
          draftId, selected.id, session.projectPath)
        if (!current()) return
        if (!result.success || result.id === undefined) throw new Error(result.error || text('恢复失败', 'Restore failed'))
        restoredId = result.id
        restoredDrafts.current.set(selected.id, restoredId)
        setRestored({ historyId: selected.id, draftId: restoredId })
        globalEventBus.emit('REFRESH_RESOURCE', { resources: ['drafts'], projectPath: session.projectPath, projectSession: session })
      }
      const draft = await ipc.invokeWithProjectSession(session, 'db:draft-get-full', restoredId, session.projectPath)
      if (!current()) return
      if (!draft) throw new Error(text('恢复草稿已创建，请从草稿列表打开', 'The restored draft was created. Open it from the draft list.'))
      const filePath = formatResourceUri({ kind: 'draft', id: draft.id })
      useEditorStore.getState().openFile({
        id: filePath, filePath, type: 'chapter',
        name: text(`第${draft.chapterNumber}章 v${draft.version}`, `Chapter ${draft.chapterNumber} v${draft.version}`),
        content: draft.content, savedContent: draft.content, draftId: draft.id,
        chapterNumber: draft.chapterNumber, draftStatus: 'draft', projectKey: session.projectPath,
        projectSessionLease: session.leaseId,
      })
      onClose()
    } catch (e) { if (current()) setError(restoredId === undefined ? String(e)
      : text(`草稿已恢复，打开失败：${e}`, `The draft was restored, but could not be opened: ${e}`)) }
    finally { pending.current = false; if (current()) setBusy(false) }
  }

  return <Dialog open onOpenChange={open => { if (!open && !busy) onClose() }}>
    <DialogContent>
      <DialogHeader>
        <DialogTitle>{text('正文保存历史', 'Manuscript save history')}</DialogTitle>
        <DialogDescription>{text('选择快照预览，恢复时创建新草稿。当前编辑保留。', 'Preview a snapshot and restore it as a new draft. Current edits are kept.')}</DialogDescription>
      </DialogHeader>
      <div className="p-4 space-y-3">
        <div className="max-h-40 overflow-auto space-y-1">
          {entries.length === 0 && <p>{text('暂无保存记录', 'No saved snapshots')}</p>}
          {entries.map(entry => <Button key={entry.id} variant="outline" disabled={busy}
            onClick={() => { void preview(entry.id) }}>
            {text(`快照 #${entry.id}`, `Snapshot #${entry.id}`)} · {entry.createdAt}
          </Button>)}
          {more && <Button disabled={busy} onClick={() => { void loadMore() }}>{text('加载更早记录', 'Load older snapshots')}</Button>}
        </div>
        {selected && <pre aria-label={text('历史正文预览', 'Snapshot preview')} className="min-h-12 max-h-64 overflow-auto whitespace-pre-wrap">{selected.body || text('（空正文）', '(Empty manuscript)')}</pre>}
        {error && <p role="alert">{error}</p>}
      </div>
      <DialogFooter>
        <Button variant="outline" disabled={busy} onClick={onClose}>{text('关闭', 'Close')}</Button>
        <Button disabled={busy || !selected} onClick={() => { void restore() }}>{restored && restored.historyId === selected?.id
          ? text('打开已恢复草稿', 'Open restored draft') : text('恢复为新草稿', 'Restore as new draft')}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
}
