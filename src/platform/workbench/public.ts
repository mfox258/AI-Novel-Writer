/** Host-rendered built-in ABI, separate from proposed extension wire formats. */
export interface WorkbenchActivity {
  readonly id: string
  readonly label: { readonly zh: string; readonly en: string }
  readonly icon: 'folder' | 'book' | 'users'
  readonly view: string
}
export interface WorkbenchDefinition {
  readonly id: string
  readonly label: { readonly zh: string; readonly en: string }
  readonly activities: readonly WorkbenchActivity[]
}
/** Declarations carry no React, CSS, callbacks, transport or storage handles. */
export function validateWorkbench(definition: WorkbenchDefinition): void {
  if (!definition.id.trim() || !definition.label.zh.trim() || !definition.label.en.trim()) throw new Error('INVALID_WORKBENCH')
  const ids = new Set<string>(), views = new Set<string>()
  for (const activity of definition.activities) {
    if (!activity.id.trim() || ids.has(activity.id) || views.has(activity.view)
      || !activity.view.trim()
      || !['folder', 'book', 'users'].includes(activity.icon)
      || !activity.label.zh.trim() || !activity.label.en.trim()) throw new Error('INVALID_WORKBENCH_ACTIVITY')
    ids.add(activity.id)
    views.add(activity.view)
  }
}
