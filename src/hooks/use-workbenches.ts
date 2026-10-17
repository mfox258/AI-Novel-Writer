import { useEffect, useSyncExternalStore } from 'react'
import { workbenchHost } from '../bootstrap/workbench'

export function useWorkbenches() {
  const snapshot = useSyncExternalStore(workbenchHost.subscribe, workbenchHost.getSnapshot)
  useEffect(() => {
    void workbenchHost.start().catch(error => console.error('[Workbench] Activation failed', error))
  }, [])
  return snapshot
}
