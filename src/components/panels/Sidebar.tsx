/**
 * Sidebar — 左侧导航面板容器
 *
 * 纯路由容器，根据 sidebarView 切换子视图。
 * 所有子视图已拆分到 sidebar/ 子目录。
 */

import { useState, useEffect } from 'react'
import { useLayoutStore } from '../../stores/layout-store'
import { ContextMenu } from '../ui/ContextMenu'
import KnowledgePanel from './KnowledgePanel'
import HomeSidebarPanel from './sidebar/HomeSidebarPanel'
import ProjectTree from './sidebar/ProjectTree'
import CharactersView from './sidebar/CharactersView'
import {
  registerMenuSetter, unregisterMenuSetter,
  type SidebarMenuState,
} from './sidebar/sidebar-menu'
import { useLocaleStore } from '../../stores/locale-store'
import { useWorkbenches } from '../../hooks/use-workbenches'

const hostViews = { project: ProjectTree, knowledge: KnowledgePanel, characters: CharactersView }

/** 左侧面板 */
export default function Sidebar() {
  const sidebarView = useLayoutStore(s => s.sidebarView)
  const text = useLocaleStore(s => s.text)
  const workbenches = useWorkbenches()
  const contribution = workbenches.workbenches.flatMap(item => item.activities)
    .find(item => item.view === sidebarView)
  const Content = contribution && Object.hasOwn(hostViews, contribution.view)
    ? hostViews[contribution.view as keyof typeof hostViews] : undefined
  // 全局右键菜单状态
  const [sidebarMenu, setSidebarMenu] = useState<SidebarMenuState | null>(null)
  useEffect(() => {
    let current = true
    queueMicrotask(() => { if (current) setSidebarMenu(null) })
    return () => { current = false }
  }, [contribution])

  // 注册 / 注销右键菜单 setter
  useEffect(() => {
    registerMenuSetter(setSidebarMenu)
    return () => { unregisterMenuSetter() }
  }, [])

  const viewTitles: Record<string, string> = {
    home:       text('主页', 'Home'),
    project:    text('项目结构', 'Project'),
    knowledge:  text('知识库', 'Knowledge'),
    characters: text('角色管理', 'Characters'),
  }

  return (
    <div
      className="skin-workspace-panel w-full h-full flex flex-col overflow-hidden"
      style={{
        backgroundColor: 'var(--color-sidebar)',
        borderRight: '1px solid var(--color-border)',
      }}
    >
      <div className="panel-header">
        <span>{contribution ? text(contribution.label.zh, contribution.label.en) : viewTitles[sidebarView]}</span>
      </div>
      <div className="flex-1 overflow-y-auto py-1">
        {sidebarView === 'home'       && <HomeSidebarPanel />}
        {sidebarView !== 'home' && Content && <Content />}
        {sidebarView !== 'home' && !Content && <p role="status" className="p-3 text-sm">
          {workbenches.state === 'loading'
            ? text('正在装载工作台…', 'Loading workbench…')
            : text('工作台暂不可用，作品数据仍保留。', 'Workbench unavailable. Your project data is retained.')}
        </p>}
      </div>

      {/* 动态右键菜单 */}
      {sidebarMenu && contribution && (
        <ContextMenu
          items={sidebarMenu.items}
          position={sidebarMenu.position}
          onClose={() => setSidebarMenu(null)}
        />
      )}
    </div>
  )
}
