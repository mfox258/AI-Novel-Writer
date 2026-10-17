import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it } from 'vitest'
import { legacyNovelWorkbenchId, workbenchHost } from '../../../bootstrap/workbench'
import { useLocaleStore } from '../../../stores/locale-store'
import LeftToolWindowBar from '../LeftToolWindowBar'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

it('withdraws and restores novel navigation with the workbench lifecycle', async () => {
  const originalLocale = useLocaleStore.getState()
  useLocaleStore.setState({ locale: 'en-US', initialized: true })
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  try {
    await workbenchHost.start()
    await act(async () => root.render(<LeftToolWindowBar />))
    expect(container.querySelector('[title="Chapter blueprint"]')).not.toBeNull()
    expect(container.querySelector('[title="Cast"]')).not.toBeNull()
    await act(async () => workbenchHost.stop(legacyNovelWorkbenchId))
    expect(container.querySelector('[title="Chapter blueprint"]')).toBeNull()
    expect(container.querySelector('[title="Version history"]')).toBeNull()
    expect(container.querySelector('[title="Cast"]')).toBeNull()
    expect(container.querySelector('[title="Welcome"]')).not.toBeNull()
    await act(async () => workbenchHost.start())
    expect(container.querySelector('[title="Chapter blueprint"]')).not.toBeNull()
    expect(container.querySelector('[title="Cast"]')).not.toBeNull()
  } finally {
    await act(async () => root.unmount())
    container.remove()
    useLocaleStore.setState(originalLocale)
  }
})
