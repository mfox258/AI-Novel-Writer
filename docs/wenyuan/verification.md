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

## 续批：不可变正文快照与恢复（2026-10-17）

M07将当前桌面schema提升为8。新增历史记录与正文更新在同一SQLite事务内，恢复新建草稿。以下均使用nvm目录内Node 22.22.0；浏览器使用本机Chrome，未切换全局Node或重建Electron ABI。

- 迁移注册、仓储与共享契约：最初5个文件59项通过；追加正文引用更换用例后，历史仓储8项通过。覆盖seed不重复、失败迁移回滚、正文/历史互相约束回滚、空正文、无变化不追加、分页、不可原位修改、显式删除级联和定稿历史恢复为新草稿。
- 控制器项目会话、原保存事务、修稿合并及定稿：4个文件67项通过；历史读取与恢复沿用session门禁，过期项目路径不能读取或写入。
- 浏览器：历史弹窗3项及已有编辑器/导航10项通过。独立审查指出“恢复成功但打开失败后再次恢复会重复创建”；修复为缓存已创建草稿ID并只重试打开，历史弹窗4项复验通过。加上已有10项共14项行为证据。
- Portable实现owner运行字段政策、归档及恢复相关122项通过，补充防伪检查后定向33项通过。实际数据库文件往返验证历史ID、正文和时间戳保留，重新打开不重复seed，恢复后仍能追加且拒绝原位修改。
- TypeScript `--noEmit`、主实现18个变更文件ESLint零警告、i18n文案覆盖及生产Vite构建通过；构建日志在忽略目录`.runtime/wenyuan-history-build.log`。

首次空正文浏览器预览因空`pre`高度为零而失败，已增加明确空正文标记并复验。扩大迁移回归发现旧版号、序列和域摘要断言须适配schema8；同时识别新增历史seed会影响跨版本域摘要比较，生产迁移需保留旧字段投影与当前完整历史证据。修复与后续结果记于下文，不将初次失败记成通过。

本批实现正文快照历史，仍不等于持久expected-head、跨重启operationId重放或完整Document/Revision分支模型。未进行安装包、真实Electron交互或全量旧项目资格验收。

### 迁移证据修复与最终限制

当前schema完整`domain`保留历史表，新增`preHistoryDomain`仅用于旧版跨版本比对、`saveHistoryDomain`用于历史独立校验；旧`preIdentityDomain`排除新seed。legacy copy即使做运行历史脱敏，也须单独比较保存历史证据。该生产增量独立静态审查无阻塞finding，恢复UI重复创建finding已复验关闭。

- 修复后旧SQLite迁移29/29、项目升级12/12通过。显式target7资格保留，schema8初始历史另行验证，当前历史变化仍会改变完整域摘要。
- 格式迁移本批8项定向用例组合运行7项通过、schema8真实文件用例超出默认5秒；该用例隔离运行通过（主线程3.57秒，owner先前4.07秒）。未提高超时。8项均有通过记录，没有一次组合全绿记录。
- 格式迁移整文件两次出现Vitest worker意外退出（一次22项已通过；排除WAL/Lance单例后仍在23项通过时退出），原因未定位，不能将其归因于该单例或宣称整文件通过。未修改生产逻辑绕过该失败。
- 主线程将先前并发时超时的portable格式7项串行复验，全部通过。扩大组合回归原始结果为129项通过、18项失败；失败中的旧版号/序列/域摘要断言已修复，5项portable超时经上述串行通过。原失败记录保留。
- 最终TypeScript通过；服务变更代码ESLint发现测试夹具未使用变量，改为复制后删除键，再次检查通过。i18n、生产构建及`git diff --check`通过。
