# 本批任务协作与项目文档：参考依据及 REA 分析

调研日期：2026-10-12。范围为已确认的 **1、2、3、5，以及 D1、D2、D3、D4、D5、D7、D8、D9、D10、D11**。

## 结论先看

采用 Tiptap 免费编辑器与扩展、Yjs 13 和 Tiptap 的 Yjs/ProseMirror 绑定，复用编辑、协作合并与协作光标的基础能力；权限、评论、版本、回收站、任务关联、个人 AI 和保存反馈由 AgileCampus 自己实现。

多人同步采用本项目设计的 **带权限校验的 HTTP 轮询与 Yjs 增量合并**。这是为现有 Next.js、Cloudflare 入口及 2 GiB 服务器选择的传输方案。Hocuspocus 是经过许可证核对的备选方案，本批不接入它，也不把 HTTP 轮询称作 WebSocket。

商业平台部分来自官方公开文档；没有登录飞书、钉钉、Jira 或 PingCode 测试账号，**不能据此声称已用 REA 实测这些商业平台，或掌握其内部同步实现**。实际 REA 对象是从 npm 获取的已发布编辑器包及其发布时附带的 source map。本文是分析依据，功能是否完成以本项目实现与验收记录为准。

## 每项借鉴什么

下表中“观察”指官方资料明确介绍的能力；“设计”是适配课程项目的选择，不是商业产品的实现结论。

| 编号 | 参考观察及来源 | 我们的设计 |
| --- | --- | --- |
| 1 | Trello 在卡片中集中管理检查项。[官方说明](https://support.atlassian.com/trello/docs/how-to-use-advanced-checklists-to-set-due-dates/) | 任务内增加可勾选、可编辑的完成清单；需要独立负责人和截止时间的工作仍使用子任务。 |
| 2 | Jira 的列数量约束会显示视觉提醒，且数量不受快捷筛选影响。[官方说明](https://support.atlassian.com/jira-software-cloud/docs/configure-columns/) | 给“进行中”设置可关闭的软限制；完整项目计数，超过时提示但不阻止操作。 |
| 3 | Jira 支持关注工作项并接收更新。[官方说明](https://support.atlassian.com/jira-software-cloud/docs/watch-share-and-comment-on-a-work-item/) | 成员主动关注/取消关注任务，沿用现有通知中心；权限不足时不能关注或读取通知。 |
| 5 | 项目工具将工作项与相关资料集中关联。[Teambition 项目说明](https://www.teambition.com/manageproject?region=cn) | 将现有会议与资料、成果或项目文档关联到任务，不再建立独立网盘。 |
| D1、D2 | 飞书支持丰富内容、快捷插入、多人编辑及自动保存；钉钉文档也公开介绍实时协同与实时保存。[飞书](https://www.feishu.cn/hc/zh-CN/articles/945900971706-快速上手文档)、[钉钉](https://page.dingtalk.com/document) | 浏览器内编辑，清晰展示同步/已保存/离线状态，允许多个受授权成员共同写同一篇文档。 |
| D3 | 飞书提供编辑历史及恢复入口。[官方说明](https://www.feishu.cn/hc/zh-CN/articles/753686977351-查看和还原文档历史记录) | 保留快照、修改人与时间；恢复产生新的当前版本，不能抹掉原历史。 |
| D4 | 飞书及 Confluence 提供内容评论；Confluence 评论可形成反馈讨论。[飞书](https://www.feishu.cn/hc/zh-CN/articles/945900971706-快速上手文档)、[Confluence](https://support.atlassian.com/confluence-cloud/docs/comment-on-pages-and-blog-posts/) | 评论定位到稳定段落标识，支持回复、解决与重新打开；段落已删时说明原位置失效，不能错误跳到其他段落。 |
| D5、D7 | PingCode 公开介绍分组/页面知识体系、文档关联研发工作及文档生成项目任务。[官方说明](https://www.pingcode.com/zh/product/wiki) | 在项目内分组与搜索文档，并与任务双向关联；只显示用户有权阅读的文档。 |
| D8 | 飞书通过文档分享管理访问权限。[官方说明](https://www.feishu.cn/hc/zh-CN/articles/945900971706-快速上手文档) | 使用阅读/评论/编辑三档、项目权限与私人草稿；后台每次请求校验，不能只隐藏按钮。 |
| D9 | 飞书介绍 Markdown 创作与文档导出，PingCode 介绍 Markdown 迁移。[飞书](https://www.feishu.cn/hc/zh-CN/articles/945900971706-快速上手文档)、[PingCode](https://www.pingcode.com/zh/product/wiki) | 首批 Markdown 导入/导出与浏览器打印；不引入 Office 转换服务，保留支持格式的明确边界。 |
| D10 | 文档恢复符合本项目已提出的误删恢复目标；本条不声称已验证某商业平台的回收站实现。 | 软删除、回收站、恢复；删除后停止协作写入，历史和关联记录保留并正确提示。 |
| D11 | PingCode 介绍文档增强、润色、语法及翻译等 AI 能力。[官方说明](https://www.pingcode.com/zh/product/wiki) | 使用当前用户已配置的 AI，对选中文字或当前文档生成建议，先预览后确认；不共用团队 API Key。 |

## 实际 REA 分析对象与证据

执行工具：本机已安装的 **rea 6.4.0 CLI**。本会话没有暴露 REA MCP 工具；只读诊断显示 Codex 注册本身已对齐，因此未修改客户端配置，也未安装原生反编译引擎。JavaScript 发布包静态分析不需要 Hopper/Ghidra。

获取方式：`npm pack <精确包版本> --ignore-scripts`。从真实发布 tarball 选出 ESM `dist` 文件、原发布 source map、package.json 和许可证组成明确限定的分析目录。没有执行发布包代码，没有把完整开源仓库的普通阅读冒充 REA。完整证据保存于本机 `.codex/tmp/agilecampus-aliyun/rea-course-documents-20261012/`；仓库仅保留小摘要，不包含下载的完整包。

| 对象 | 包/分析范围 | REA Evidence ID | 观察 |
| --- | --- | --- | --- |
| 协作扩展 | `@tiptap/extension-collaboration@3.31.4`：`dist/index.js` 与原 map | `ev_b931e1d0cd2335b92fcc607d46b7c6be6119d18fbe65dd47340ca253f6e7ae1b` | ESM 静态导入 Tiptap core、ProseMirror state 与 `@tiptap/y-tiptap`；导出 Collaboration、位置映射和变更来源帮助函数。 |
| Yjs 绑定 | `@tiptap/y-tiptap@3.0.7`：`dist/y-tiptap.js` 与原 map | `ev_bca9fc3822cbc08ecb5d5201c8712bbda6673547254cf3124e4eb1f5bed3a28d` | 发布包导出同步、光标、撤销插件，以及 ProseMirror JSON/Y 文档互转、相对位置转换函数。 |
| 协作入口关系追踪 | 上述协作扩展的唯一 ESM 主模块，`outgoing`，不作宽泛双向遍历 | `ev_9da968f8e20c7191ddc1c9db885478ff93eb1c2a8ca826822eae00b170660bf6` | 匹配 1 个入口，保留 13 个节点、22 条关系；仅是静态关系，不证明任何功能执行。 |

协作扩展分析范围的根摘要 SHA-256 为 `4990a8e1fde6637ef8312a715a3a23d58dd2c799fd2cc6fa27ff6784eafdc735`；Yjs 绑定范围为 `775ab19a141dbdb3c450c527fae6748ad3e210c7c2c104c74970d79307c489d4`。摘要及较小的 REA summary view 位于 [verification/rea-course-documents-evidence-summary.json](verification/rea-course-documents-evidence-summary.json)。摘要不是可替代完整证据的可移植 Evidence bundle。

### 从观察到实现的判断

- **观察**：两个限定发布范围均无解析失败、无省略的应用图事实；package 的导入、导出及发布 source map 可追溯。外部模块未装入同一静态图，因此外部调用的运行行为仍未知。
- **观察**：发布协作扩展代码使用共享 `Y.XmlFragment`，装配同步与协作撤销插件；并明确警告与普通 Undo/Redo 扩展重复配置。对应包文件摘要与上述 REA 身份一致；这仍属于发布代码的静态观察。
- **推断**：可复用已有编辑器/Yjs 绑定，让我们专注业务权限和持久化，避免自行编写文本冲突合并算法。
- **未知**：REA 不能由静态图证明实际断线恢复、两人同段输入、服务器重启恢复、权限撤销或版本恢复是否正确。必须在我们的实现里做双会话和数据库测试。
- **限制**：语义图覆盖不是完备执行分析。协作扩展保留 176 个语义未知点，Yjs 绑定保留 2176 个语义未知点，包含动态值、对象和调用关系。应用图完整仅表示这两个限定包范围已遍历，不代表第三方产品、整个 Tiptap 生态或完整系统被逆向完成。

## 依赖与许可证核对

以下版本来自本次 npm registry 查询，不以 GitHub 默认分支代替稳定发布包：

| 模块 | 核对版本 | 许可证及用途 |
| --- | --- | --- |
| `@tiptap/react`、`@tiptap/pm`、免费编辑扩展 | 3.31.4 | MIT；React peer 包含 `^19.0.0`。 |
| `@tiptap/extension-collaboration`、`collaboration-caret` | 3.31.4 | MIT；peer 需要 `@tiptap/y-tiptap ^3.0.7`。 |
| `@tiptap/y-tiptap` | 3.0.7 | MIT；实际发布许可证保留 Kevin Jahns 与 Tiptap GmbH 版权声明。 |
| `@tiptap/markdown`、`extension-unique-id`、`extension-table` | 3.31.4 | MIT；可分别支撑 Markdown、稳定块标识和表格。 |
| `yjs` | 13.6.33 | MIT；使用稳定 13 系列。 |
| `y-prosemirror` | 1.3.7 | MIT；本次核对的备选绑定，不等于已接入。其仓库 main 已有 Yjs 14 开发内容，不能混用。 |
| `@hocuspocus/server`、`@hocuspocus/provider` | 4.7.1 | MIT；server 要求 Node >=22。本批只评估，不安装为部署服务。 |

保留所复用开源包的版权与许可证；不复制商业客户端源代码、图标或品牌界面。Tiptap 托管协作、Pro 评论/版本、AI Toolkit、Office 转换不属于本批免费依赖。评论、快照版本、个人 AI 与权限采用项目自有实现。[Tiptap 官方 Next.js 指南](https://tiptap.dev/docs/editor/getting-started/install/nextjs)、[Yjs 项目](https://github.com/yjs/yjs)、[稳定 y-prosemirror 说明](https://github.com/yjs/y-prosemirror/blob/master/README.md)

Next.js 集成使用 Client Component 与 `immediatelyRender: false` 避免服务端编辑器渲染造成水合错误；协作模式关闭 StarterKit 的 `undoRedo`，使用协作撤销。[官方集成指南](https://tiptap.dev/docs/editor/getting-started/install/nextjs)

## HTTP 协作方案需要验证的边界

这部分是我方设计审阅，不是 REA 对商业应用的观察。

1. **合并与持久化**：在数据库事务中锁住文档行，读取最新 Yjs 二进制，再合并增量。多个用户不能先读取同一旧状态，再各自覆盖保存。正文以 Yjs 状态为唯一真相，搜索文本和 JSON 从服务器合并结果派生。
2. **权限与隐私**：每次正文、presence、评论、版本、搜索及导出请求检查文档 ACL、项目成员关系、删除和归档状态。私有文档不能通过搜索摘要、任务关联、通知或在线成员信息泄露。
3. **在线状态**：presence/awareness 不保存私人正文；服务器确认当前登录用户，不接受客户端冒充其他用户。掉线用 TTL 清理，避免永远显示在线。
4. **恢复与删改**：恢复版本使用新的 epoch；拒绝旧 epoch 的更新，避免旧浏览器把被恢复内容重新合并回来。客户端重新加载前应提示并保留尚未同步的内容，不可静默丢弃。回收站中的文档禁止继续编辑。
5. **一致性与反馈**：标题/目录等元数据与 CRDT 正文分开更新。显示已保存必须以服务器确认已持久化为准；请求失败保留待发送更新。重复的已应用增量不应产生重复版本。
6. **负载**：限制请求体/更新体/文档大小，返回按 state vector 计算的差量；后台标签页适当降低频率。不能每秒为每个静止页面生成新版本。
7. **评论定位**：稳定段落 ID 在复制、导入和多人插入后仍唯一；段落删除或恢复后识别失效锚点，不把旧评论定位到不相关内容。
8. **AI 应用**：AI 只使用本人配置的 provider/key；请求以有权读取且主动选择的内容为上下文。建议应用前确认文档仍可编辑、所选内容仍匹配，不用旧建议覆盖其他人刚写入的全文。

至少验证两名可编辑成员同时输入、断线再连、只读成员写入被拒、私人草稿跨成员访问被拒、版本恢复后旧更新被拒、删除后协作停止、Markdown 来回转换和个人 AI 建议确认应用。实际结果应写进本批功能验收记录。

## 未选项目

按照本次选择，暂未实现范围为 **4（讨论/复盘转任务）、6（需求/任务/缺陷分类）、7（轻量测试记录）、8（迭代趋势图）、9（试用反馈收集）、D6（课程文档模板）**。已有“老师成果反馈转任务”等功能继续保留；未选是指本轮新增候选未进入开发范围。
