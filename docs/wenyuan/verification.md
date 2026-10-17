# 首批重构验证

日期：2026-10-17。基准：`main` / `daad388bc3535b6d483f565d7d05e24a1485acac`；结果对应基准上的本批未提交修改，不代表基准提交或正式安装包已经具备这些能力。

## 环境

- nvm原有版本仅16.20.2，本批通过nvm安装22.22.0。验证进程显式使用22.22.0的Node，未切换系统默认Node。
- pnpm11.11.0按原lockfile安装依赖，未修改lockfile。Electron官方下载两次失败，临时设置进程级`ELECTRON_MIRROR`后成功；仓库npm配置和系统代理未改。
- Vitest4.1.11，Vite8.2.2；浏览器测试使用本机Google Chrome的headless运行方式。better-sqlite3使用本次Node环境下安装的原生模块。

## 已运行结果

| 验证 | 结果 | 边界 |
|---|---|---|
| 11份单元/仓储/控制器回归 | 86项通过 | 包括运行时7、工作台5、手动客户端16、保存事务3、SQLite重开1，以及定稿、会话、合并、物理正文保存、品牌和语言相关回归 |
| 5份浏览器用例 | 8项通过 | 手动创建/失败、无蓝图空正文历史比较/恢复、工作台停用/恢复导航、语言和既有编辑导航；IPC为受控测试接口 |
| TypeScript `tsc --noEmit` | 通过 | 全部`src`和`electron`纳入仓库原配置 |
| ESLint本批新文件及受影响UI/服务 | 通过，零warning | 未将整个历史仓库宣称为lint全绿 |
| i18n coverage | 通过 | 渲染端与主进程边界文案检查 |
| Vite生产构建 | 通过 | renderer、Electron main与preload均生成；存在依赖侧弃用项及大chunk提示 |
| `git diff --check` | 通过 | 旧CRLF工作副本提示不是内容错误 |

SQLite文件测试不使用模型和蓝图：在临时项目数据库内创建空草稿和后续草稿，保存正文，关闭数据库句柄后重新打开，验证原文，恢复空正文为第三个草稿且不覆盖第二稿。它不是完整Electron项目打开、安装包或迁移资格测试。

首次SQLite文件用例超过默认5秒：原因是测试夹具初始化大量DDL时逐条提交。已将测试夹具初始化放入单一事务，修正后同一用例51ms通过；未提高超时或跳过断言。

## 可复现命令

使用Node22及安装完毕的仓库依赖，命令与本次直接调用依赖入口等价：

```powershell
pnpm exec vitest run src/platform/plugin-runtime/runtime.test.ts src/bootstrap/workbench.test.ts src/services/manual-manuscript.test.ts electron/repositories/__tests__/draft-save-atomicity.test.ts electron/repositories/__tests__/manual-manuscript-persistence.test.ts electron/repositories/__tests__/draft-repository-finalization-guard.test.ts electron/controllers/__tests__/db-controller-project-context.test.ts src/stores/__tests__/draft-store-merge-revision.test.ts src/components/panels/__tests__/editor-area-physical-save.test.ts src/shared/__tests__/brand.test.ts electron/__tests__/i18n.test.ts
pnpm exec vitest run --config vitest.browser.config.ts src/components/layout/__tests__/workbench-lifecycle.browser.tsx src/components/dialogs/ManualManuscriptDialog.browser.tsx src/components/editor/__tests__/VersionHistory.resource.browser.tsx src/components/editor/__tests__/VersionHistory.locale.browser.tsx src/components/layout/v2/__tests__/v3-editor-navigation.browser.tsx
pnpm run typecheck
pnpm run check:i18n
pnpm exec vite build
```

浏览器无Playwright配套Chromium时，使用`AI_NOVEL_VITEST_CHROMIUM`指定本机Chrome/Chromium可执行文件。不要将Node原生ABI的测试通过当作Electron原生ABI或发行包通过。

## 独立审查与修复

只读独立审查确认首次宿主实现缓存启动Promise，导致停用后再启动成功返回但不激活。已清理停止后的启动缓存，并增加重启及并发生命周期回归。审查提出旧蓝图/世界/剧情/历史入口未随停用撤下、菜单可能残留：已接线撤下和关闭菜单；浏览器已确认停用撤下、重启恢复全部旧小说快捷入口。

实际UI视图仍是宿主对旧小说组件的适配，不是完整受限功能插件。第三方代码隔离、授权撤销执行、逐次保存不可变修订/并发幂等、全量旧项目迁移、Electron安装包及正式发布本批未验证。

## 续批：正文保存基线保护（2026-10-17）

使用nvm已安装的`D:/software/nvm/v22.22.0/node.exe`，未切换全局默认版本。

- 4个单测文件、46项通过：`draft-save-atomicity`、`db-controller-project-context`、`manual-manuscript-persistence`、`draft-store-merge-revision`。覆盖过期基线拒绝且正文/字数不变、空正文基线、缺少IPC基线拒绝、稳定冲突码和原有事务回滚。
- 3个浏览器文件、10项通过：`DraftEditor-ai-snapshot`、`DraftEditor-revision-source`、`v3-editor-navigation`。覆盖冲突后保留本地正文/基线/dirty、AI冻结快照、保存中输入后下次使用正确基线、切换标签保存。
- TypeScript `--noEmit`、7个变更源码/测试文件的ESLint（零警告）、`git diff --check`通过。
- 追加定稿保护、草稿来源依赖和编辑器物理保存回归：3个文件、17项通过；单测合计7个文件、63项。i18n文案覆盖检查通过。
- 独立只读审查未发现阻塞问题；审查者另行运行仓储/controller 40项和相关浏览器7项通过。重复快捷键保护补充后，`DraftEditor-ai-snapshot`浏览器7项再次通过。

本批不改物理schema和可移植格式；未运行新安装包或原生Electron交互验证。正文相等校验不代表持久修订号校验或幂等重放。不可变保存历史和迁移/导出闭包仍待实施。
