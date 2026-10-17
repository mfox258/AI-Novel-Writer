import type { WorkbenchDefinition } from '../../platform/workbench/public'

/** Legacy novel implementations are bound by the host, not imported by the declaration. */
export const longNovelWorkbench: WorkbenchDefinition = {
  id: 'wenyuan.builtin.long-novel',
  label: { zh: '长篇小说', en: 'Long-form fiction' },
  activities: [
    { id: 'novel.project', view: 'project', icon: 'folder', label: { zh: '项目', en: 'Project' } },
    { id: 'novel.reference', view: 'knowledge', icon: 'book', label: { zh: '资料', en: 'Reference' } },
    { id: 'novel.characters', view: 'characters', icon: 'users', label: { zh: '角色', en: 'Cast' } },
  ],
}
