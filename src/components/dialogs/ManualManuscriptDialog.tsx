import { useRef, useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '../ui/Dialog'
import { Button } from '../ui/Button'
import { Input } from '../ui/Input'
import { useLocaleStore } from '../../stores/locale-store'
import { useDraftStore } from '../../stores/draft-store'
import { useEditorStore } from '../../stores/editor-store'
import { createManualManuscript, parseManualChapterNumber } from '../../services/manual-manuscript'
import { formatResourceUri } from '../../shared/project-paths'
import type { ProjectSessionContext } from '../../shared/ipc-channels'
import { isProjectSessionCurrent } from '../project-session-gate'
import { globalEventBus } from '../../shared/event-bus'

export default function ManualManuscriptDialog({ session, onClose }: {
  session: ProjectSessionContext
  onClose: () => void
}) {
  const text = useLocaleStore(s => s.text)
  const [chapter, setChapter] = useState('1')
  const [busy, setBusy] = useState(false)
  const pending = useRef(false)
  const [error, setError] = useState('')
  const create = async () => {
    if (pending.current) return
    pending.current = true
    setBusy(true)
    setError('')
    try {
      const draft = await createManualManuscript(parseManualChapterNumber(chapter), session)
      if (!isProjectSessionCurrent(session)) return
      const filePath = formatResourceUri({ kind: 'draft', id: draft.id })
      useEditorStore.getState().openFile({
        id: filePath, filePath, type: 'chapter',
        name: text(`第${draft.chapterNumber}章 v${draft.version}`, `Chapter ${draft.chapterNumber} v${draft.version}`),
        content: '', savedContent: '', draftId: draft.id, chapterNumber: draft.chapterNumber,
        draftStatus: 'draft', projectKey: session.projectPath, projectSessionLease: session.leaseId,
      })
      globalEventBus.emit('REFRESH_RESOURCE', { resources: ['drafts'], projectPath: session.projectPath, projectSession: session })
      await useDraftStore.getState().loadChapterDrafts(draft.chapterNumber, session.projectPath, session)
      if (isProjectSessionCurrent(session)) onClose()
    } catch (e) {
      if (isProjectSessionCurrent(session)) setError(e instanceof Error ? e.message : String(e))
    } finally {
      pending.current = false
      setBusy(false)
    }
  }
  return <Dialog open onOpenChange={open => { if (!open && !busy) onClose() }}>
    <DialogContent>
      <form onSubmit={e => { e.preventDefault(); void create() }}>
        <DialogHeader>
          <DialogTitle>{text('新建空白正文', 'New blank manuscript')}</DialogTitle>
          <DialogDescription>{text('无需模型或蓝图。新增草稿，不替换已定稿正文。', 'No model or blueprint needed. Creates a new draft and preserves finalized text.')}</DialogDescription>
        </DialogHeader>
        <div className="p-6 space-y-3">
          <label htmlFor="manual-chapter">{text('章节号', 'Chapter number')}</label>
          <Input id="manual-chapter" inputMode="numeric" value={chapter} disabled={busy} onChange={e => setChapter(e.target.value)} autoFocus />
          {error && <p role="alert" className="text-sm text-[var(--color-error)]">{error}</p>}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" disabled={busy} onClick={onClose}>{text('取消', 'Cancel')}</Button>
          <Button type="submit" disabled={busy}>{busy ? text('创建中…', 'Creating…') : text('创建并打开', 'Create and open')}</Button>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>
}
