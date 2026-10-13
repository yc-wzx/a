# AgileCampus 敏捷校园 · 唯笃队

面向高校课程团队的轻量项目管理网站。在[老师原始项目](https://github.com/sdiver/agilecampus)基础上增量开发，保留团队、看板、任务、甘特、AI 助手和资源登记，完善“规划任务 → 迭代开发 → 提交成果 → 教师反馈 → 修改重交 → 复盘与证据导出”。

已补齐原规划 P0–P2 的代码及部署方案，接入五项此前完成的 P3 和个人课表驱动的短期工作规划，并增加临时事件补充、安全重新规划及自愿共享模糊忙碌时间。**已部署到阿里云香港服务器；2026-10-12 启用 Cloudflare 固定入口：[AgileCampus 网站](https://weidu-agilecampus.pw)。** 负责人已确认校园网电脑关闭代理能打开登录页。腾讯文档团队项目主页独立保留。真实同学试用、真实飞书／AI 仍待实际条件，规则规划已经可以使用。

## 团队新增功能

**2026-10-13 界面改进：** 项目目录增加真实统计、检索筛选和文档等快捷入口；团队目录增加成员与项目数量、角色筛选、邀请码复制和集中表单；通知按日期分组、按项目筛选并保留范围内已读操作。页面指引并入「新手教程」菜单，使用指南改为正式的角色流程与操作章节。见 [界面与教程说明](docs/course-ui-handbook-20261013.md) 和 [上线与验证记录](docs/course-live-20261013.md)。

**2026-10-13 课堂演示准备：** 已创建教师、学生、团队管理员三个持续保留的演示账号，以及独立的模拟团队、两项目、任务、文档、成果审核和课表规划样例。个人 AI 按要求暂不配密钥，展示设置入口与真实规则规划。登录密码通过私有文件交付；功能覆盖与验证见 [三角色演示说明](docs/role-demo-20261013.md)。

**2026-10-12 本批新增：任务检查清单、进行中数量提醒、任务关注通知、资料关联，以及项目在线文档。** 文档支持协作编辑、段落评论与回复、版本比较恢复、目录搜索、任务关联、阅读／评论／编辑权限、个人草稿、Markdown 导入导出、打印、回收站和个人 AI 选区预览。操作、3–4 人试用和未选项见 [本批交付说明](docs/course-documents-20261012.md)，开源及 REA 依据见 [分析报告](docs/rea-course-documents-20261012.md)。

| 功能 | 用户可以做什么 |
|---|---|
| 任务三视图【2026-10-12 新增，候选 1】 | 看板、列表、甘特图切换，共用筛选和任务详情；列表按截止日期／优先级／标题排序，旧时间线地址继续有效 |
| 成员工作量【2026-10-12 新增，候选 2】 | 概览看每人未完成、完成、逾期数量，展开待处理任务并跳转成员筛选；主子任务各计一条，不做贡献评分 |
| 常用筛选【2026-10-12 新增，候选 3】 | 保存、应用、重命名、删除筛选组合、分组、视图和排序；当前浏览器按账号和项目隔离，不跨设备同步 |
| 项目分组侧栏【2026-10-12 新增，候选 5】 | 固定左侧导航、明确当前项目与页面；协作、成果与记录可展开，保留原有功能入口 |
| 新手教程【2026-10-13 完善】 | 正式使用指南按负责人／成员／教师介绍流程；「新手教程」统一提供使用指南与当前页面操作指引，首次工作台提示可关闭 |
| 删除里程碑【2026-10-12 新增】 | 管理员先查看影响范围、再确认删除；任务与成果保留，解除当前阶段关联，历史版本及反馈保持原记录 |
| 个人 AI 助手【2026-10-12 新增】 | 每人配置自己的服务商、模型、API 密钥、助手名称及表达偏好；加密保存、测试连接、替换／删除；聊天、迭代草案和课表规划均使用当前账号配置 |
| 个人工作台【2026-10-12 交互改进】 | 查看需关注事项、下一步入口、本人任务筛选、项目进度、今日日程、重新规划提醒和教师反馈；Ctrl K 快速查找，支持键盘操作与刷新反馈 |
| 教师项目总览【本轮补齐】 | 集中看任教团队项目的任务、迭代、成果、活动和风险 |
| 项目概览 | 目标／周期／里程碑／起步引导、双进展、动态、项目内待办 |
| 任务详情、任务池与迭代 | 验收标准、指派／日期／标签／依赖／子任务／阻塞；排序入轮、开始、结束结转、历史与复盘 |
| 任务评论与 @【本轮补齐】 | 发／改／删评论，选择成员通知，点击定位来源，权限与重复请求有校验 |
| 项目公告【本轮补齐】 | 教师／管理员发布、修改、置顶替换、撤下、重发；概览展示置顶，学生只读 |
| 成果与教师验收 | 登记报告／PPT／视频／代码链接，私有草稿、正式不可变版本、验收／退回／重交 |
| 教师反馈转任务 | 明确确认后建立修改任务，任务与原反馈相互定位 |
| 规则周报【本轮补齐】 | 按周整理真实任务事件、成果提交和审核；当前阻塞／逾期单列，Markdown 下载 |
| 透明风险【本轮补齐】 | 四条明确规则，显示来源、阈值、计算时间和数据不足条件；不自动评分 |
| 统一过程证据【本轮补齐】 | 汇总任务、评论、迭代、复盘、正式成果与反馈，按成员／阶段／日期等筛选导出 |
| AI 连续上下文【本轮补齐】 | 项目共享／本人个人会话、有界历史与分页、新业务只读工具，不泄露私有草稿或他人聊天 |
| AI 迭代草案【本轮补齐】 | 只选已有任务，生成／调整／取消／预览／明确确认后创建计划迭代；24 小时有效，版本变化拒绝旧方案 |
| 站内与外部通知【本轮补齐】 | 原指派／成果／迭代通知保留；补到期、完成、@、公告、外部发送队列与退避重试、渠道状态 |
| 部署与恢复【本轮补齐】 | 版本化迁移、健康检查、内部定时提醒、HTTPS 配置、备份／独立恢复／代码回退工具 |
| 校园项目模板【P3 本轮接入】 | 创建时选择空白／课程／科研／竞赛，非空白项目自动建立四个建议阶段 |
| 负责人交接【P3 本轮接入】 | 管理员指定／更换／清空负责人，成员查看交接历史；不提升权限 |
| 会议与资料【P3 本轮接入】 | 登记、编辑、筛选会议／文档／视频／原型链接；会议可记纪要、录制、参会人和阶段 |
| 截止日期日历【P3 本轮接入】 | 下载项目、里程碑和任务截止日期的 `.ics` 快照 |
| 成果版本对比【P3 本轮接入】 | 比较同一成果两个正式提交的标题／说明增删、链接和阶段等变化，私有草稿不参与 |
| 个人课表与短期规划【P3 本轮新增】 | 导入 ICS／CSV、手动补充课程；结合本人任务和剩余工时，避开课程并生成 7／14 天个人安排，明确确认后保存 |
| 临时事件与重新规划【本轮新增】 | 无需填写原因即可补充占用时间，带入原目标和任务重新规划；确认新草案时才替换原安排，失败或取消草案保留原安排 |
| 团队模糊日程【本轮新增】 | 本人选择日程和共享团队，老师及组员只看按半小时取整合并的忙碌时间；隐藏名称和具体事情，默认私有、随时撤回 |

任务完成率按主任务计算，成果通过率按当前正式成果计算，两者独立展示。无正式成果显示“暂无正式提交”；查询失败显示不可用，不用零条冒充成功。旧活动没有记录就不补造；已删除评论正文不导出。成果目前登记外部链接，不是内置网盘。

原有团队与角色、跨项目列表、拖拽看板、标签／依赖、甘特、AI 两段确认、Personal API Token、Agent 写入 API、资源占用登记继续保留。原 plan_sprint 语义保持兼容。

工作台新增查询的项目卡片显示含子任务的真实完成数，迭代仍按主任务计算，页面明确区分两种口径。实际复用 cmdk 和 Lucide，参考 shadcn/ui 的信息层次；实现、开源取舍和课程试用建议见 [工作台交互改进说明](docs/workspace-interaction-20261012.md)。

工作台本轮完整回归 **688 项通过、2 项跳过**，生产构建和 TypeScript 通过，12 项本地电脑交互检查通过。已上线至正式域名，工作台 7 项及现有业务回归 24 项通过，见 [工作台上线记录](docs/workspace-live-20261012.md)。线上自动化检查经代理执行；真实校园网同学试用另外记录。

完整入口与接口交接见 [P0–P2 补齐说明](docs/p0-p2-completion.md)、[五项 P3 接入说明](docs/p3-project-extensions.md)和 [本轮课表规划说明](docs/p3-personal-schedule-planning.md)；逐条状态见 [六人最新进度](docs/team-progress-20261009.md)；固定接口以 [契约 v2.0 与 P3 增量接口](docs/team-interface-contract.md) 为准。其他 P3 候选和 P4 没有记作完成。

## 主要入口

| 路由 | 说明 |
|---|---|
| /dashboard | 本人任务、当前迭代、需修改成果 |
| /help | 正式使用指南和角色流程；「新手教程」菜单统一提供当前页面操作指引 |
| /schedule | 本人课表／日程导入、修改和可投入时间设置 |
| /projects/{id}/personal-plan | 结合本人课表与项目任务的短期计划；从「AI 与草案」进入 |
| /teams/{id}/availability | 当前团队成员自愿公开的模糊忙碌时间；从团队卡片或个人计划进入 |
| /teacher | 教师／管理员多项目总览 |
| /notifications | 通知分页、未读筛选、已读与来源 |
| /projects/{id}/overview | 概览、公告、动态、双进展和风险 |
| /projects/{id} | 任务看板、详情侧栏／评论、原 AI 助手 |
| /projects/{id}?view=list 或 view=gantt | 列表／甘特图，共用任务、筛选和详情 |
| /projects/{id}/iterations | 任务池、迭代；详情含结束预览、历史和复盘 |
| /projects/{id}/deliverables | 成果列表／创建；详情含版本、审核、重交和反馈任务 |
| /projects/{id}/deliverables/{deliverableId}/compare | 两个正式成果版本的内容对比 |
| /projects/{id}/references | 会议、纪要、录制及其他资料链接 |
| /projects/{id}/documents | 文档目录、标题／正文搜索、Markdown 导入与回收站 |
| /projects/{id}/documents/{documentId} | 在线协作、评论回复、版本、关联任务、权限及个人 AI |
| /api/projects/{id}/calendar | 登录后下载截止日期日历；项目导航有导出按钮 |
| /projects/{id}/announcements | 公告列表和管理 |
| /projects/{id}/reports | 规则周报与下载 |
| /projects/{id}/evidence | 原成果证据筛选／导出 |
| /projects/{id}/evidence/process | 统一过程证据筛选／导出 |
| /projects/{id}/ai-drafts | 共享／个人会话和迭代草案 |
| /projects/{id}/timeline | 甘特时间线 |
| /teams | 团队、成员角色、项目、资源与标签 |
| /settings | 我的 AI 助手、飞书绑定与渠道状态；/settings/tokens 管理个人令牌 |

## 本地启动与测试

技术栈：Next.js 16.2 · React 19 · TypeScript · PostgreSQL 16 · Drizzle · Auth.js v5 · AI SDK v5 · Tailwind v4 · Vitest。使用 Node.js 22 或 24 及以上（P3 日历依赖不支持 Node.js 23）。

```bash
docker compose up -d
cp .env.example .env
# 编辑 .env：配置开发 DATABASE_URL、AUTH_SECRET 和本地地址
npm ci
npm run db:migrate
npm run dev
```

测试使用独立数据库。在 .env.test 配置测试 DATABASE_URL，不能指向开发／真实业务库，然后执行：

```bash
npm run db:push:test
npm test
npm run lint
npm run build
```

新建空库及已有完整迁移账本的库使用 db:migrate。没有账本的旧库先核对基线，不能直接重放初始化迁移。不要通过删除数据卷解决升级问题。

可重复本地验收脚本：

- scripts/verify-ef-integration.mjs：原成果、迭代、活动与通知串联。
- scripts/verify-p0-p2-browser.mjs：公告／评论／@／周报／证据／草案／教师页／手机宽度；需要 Playwright、Edge 和本地服务。
- scripts/verify-local-recovery.mjs：需要 PostgreSQL 客户端，可用 PG_BIN 指定路径；只在本地创建独立源库与恢复库，不覆盖已有库。
- scripts/p3-browser-smoke.mjs：验证五项 P3 功能、越权拒绝、失败保留输入和 320／390／430px 关键页面。
- scripts/verify-personal-schedule-browser.mjs：验证课表导入／修改／删除、临时事件、短期草案、原子替换、老师只看模糊时间、撤回共享、隐私及手机宽度。

浏览器脚本通过 B_TEST_URL 指定本地站点，通过 PLAYWRIGHT_MODULE 指定已安装 Playwright；cron 验收的 EF_TEST_CRON_SECRET 必须与本地服务一致。脚本使用合成账号，草案夹具和模拟模型不代表真实 AI 调用。

## 阿里云部署

已在香港 Ubuntu 24.04、2 核 2 GiB 服务器部署应用和 PostgreSQL 16，16 条迁移完成，可信 HTTPS、健康检查、后台提醒和独立备份恢复已验证。2026-10-12 17:12 教程与个人 AI 版本线上电脑浏览器 **42 项检查通过**：30 项原有流程加 12 项教程、删除及个人 AI 操作，未出现页面异常；本次自动化功能检查使用既有代理，不代替真实校园网络试用或真实 AI 调用。应用在 GitHub 构建，服务器直接加载发布包；没有公开默认管理员密码，请从 `/register` 注册自己的账号。19:33 工作台更新的 31 项线上检查见 [最新验收](docs/workspace-live-20261012.md)，此前 42 项记录见 [教程与个人 AI 验收](docs/quickstart-live-20261012.md)，维护见 [上线与维护说明](docs/aliyun-live-deployment-20261011.md)，完整步骤见 [阿里云部署与恢复方案](docs/aliyun-deployment.md)。

**2026-10-12 固定域名已接入正式 Cloudflare Tunnel。** 电信、联通、移动共 6 个独立节点及香港、美国对照均返回 HTTPS 200，负责人确认校园网电脑关闭代理可打开登录页。新域名下 30 项电脑网页功能检查在当前自动化电脑经代理通过；该电脑直接访问仍失败，不能记作直连通过。隧道开机启动及服务重启已验证，应用镜像与数据库保持原有版本。维护、证据和网络限制见 [固定入口说明](docs/cloudflare-fixed-entrance-20261012.md)。原 IP 的国内连接问题保留在 [历史排查记录](docs/aliyun-connectivity-incident-20261011.md)，没有提交工单。本轮试用只要求电脑网页。

购买后复制 deploy/production.env.example 为 .env，填写三个不同随机密钥、独立的 AI 密钥加密主密钥和真实域名，安装 Docker Compose v2 与 Node.js：

```bash
npm ci
node scripts/ops.mjs preflight
node scripts/ops.mjs release
node scripts/ops.mjs status
node scripts/ops.mjs smoke
node scripts/ops.mjs backup
```

生产用 db:migrate 增量升级；PostgreSQL 不开放公网端口，网站经 HTTPS 反向代理。备份包含业务和迁移账本，恢复只进入独立库。代码回退不能代替数据库恢复；不要运行 down -v。飞书／AI 未配置时其他协作功能仍可使用。

个人 AI 需要服务器设置 `AI_SETTINGS_ENCRYPTION_KEY`（随机 32 字节，即 64 位十六进制），独立于登录、数据库和定时任务密钥。此主密钥必须私下备份并在发布、恢复时保留；遗失后用户必须重新填写 API 密钥。各用户在设置中保存自己的 API 密钥，网站不会回退使用共享 `DEEPSEEK_API_KEY`。兼容服务商地址只允许内置服务或负责人在 `AI_ALLOWED_BASE_URLS` 中开放的 HTTPS 接口，不接受任意网址。默认个人会话；共享会话须主动选择，原共享历史仍保留。使用与开源依据见 [本轮说明](docs/quickstart-personal-ai-20261012.md)，可发群的教程见 [快速上手](docs/quickstart.md)。

## 验证状态

项目交互候选 **1、2、3、5** 已实现并于 2026-10-12 20:48 上线，未接入其余候选。完整回归 **698 项通过、2 项跳过**，本地桌面交互 10 项、线上新增交互 9 项及既有业务 24 项通过；用法和开源借鉴见 [项目视图与导航说明](docs/project-interaction-20261012.md)，源码、镜像、备份及边界见 [最新上线记录](docs/project-interaction-live-20261012.md)。线上自动化经既有代理执行，不替代校园网真实试用。

此前工作台回归为 688 项通过、2 项跳过，见 [工作台验收](docs/workspace-live-20261012.md)。P0–P3 与课表阶段的验证见 [原进度记录](docs/team-progress-20261009.md)：当时完成旧库增量升级至 `0014` 和真实 pg_dump／pg_restore 独立恢复：22 张业务表内容一致、迁移账本 15 条、旧课表默认保持私有、恢复后消息／P3 资料／个人日程可写、重复迁移正常。

真实同学试用按 [匿名模板](docs/usability-trial-template.md) 记录。阿里云容器、HTTPS、公网健康、独立恢复及固定隧道已验证；镜像回退操作、飞书／AI 真实条件仍须后续补验。


## Agent 写入 API

供 Claude Code 等浏览器之外的程序，以用户身份写入 AgileCampus。

### 认证

所有 `/api/agent/*` 端点用 **Personal API Token** 认证（区别于浏览器 session）：

```
Authorization: Bearer <token>
```

在网页「设置 → 个人访问令牌」生成，明文只显示一次；库中仅存 sha256 hash。令牌权限等同本人：只能操作有权限的团队/项目，越权返回 `403`。约定两个环境变量：

- `AGILECAMPUS_URL` — 站点地址，如 `http://localhost:3000`
- `AGILECAMPUS_TOKEN` — 令牌明文

### `POST /api/agent/tasks` — 新建任务

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `projectId` | uuid | 是 | 目标项目 |
| `title` | string | 是 | 任务标题 |
| `description` | string | 否 | 描述 |
| `assigneeId` | uuid | 否 | 负责人（须为团队成员） |
| `startDate` | string | 否 | 起始日 `YYYY-MM-DD`（供时间线排期） |
| `dueDate` | string | 否 | 截止日 `YYYY-MM-DD` |
| `milestoneId` | uuid | 否 | 里程碑（须属该项目） |
| `priority` | `low`\|`medium`\|`high` | 否 | 默认 `medium` |

```bash
curl -X POST "$AGILECAMPUS_URL/api/agent/tasks" \
  -H "Authorization: Bearer $AGILECAMPUS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"projectId":"<uuid>","title":"撰写调研问卷","startDate":"2026-07-01","dueDate":"2026-07-08","priority":"high"}'
# → { "id": "...", "title": "撰写调研问卷", "status": "todo" }
```

### `POST /api/agent/tasks/complete` — 填写完成情况

将任务标记为 `done` 并附完成说明。

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `taskId` | uuid | 是 | 目标任务 |
| `completionNote` | string | 是 | 完成说明 |

```bash
curl -X POST "$AGILECAMPUS_URL/api/agent/tasks/complete" \
  -H "Authorization: Bearer $AGILECAMPUS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"taskId":"<uuid>","completionNote":"已跑通全部演武"}'
# → { "id": "...", "status": "done" }
```

### `POST /api/agent/resource-usage` — 登记资源占用

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `teamId` | uuid | 是 | 目标团队 |
| `resourceName` | string | 是 | 资源名，如 `GPU-01` |
| `purpose` | string | 否 | 用途 |
| `startTime` | ISO 8601 | 是 | 开始时间，如 `2026-07-22T14:00:00Z` |
| `endTime` | ISO 8601 | 否 | 结束时间；省略 = 占用中 |

```bash
curl -X POST "$AGILECAMPUS_URL/api/agent/resource-usage" \
  -H "Authorization: Bearer $AGILECAMPUS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"teamId":"<uuid>","resourceName":"GPU-01","purpose":"训练模型","startTime":"2026-07-22T14:00:00Z"}'
# → { "id": "...", "resourceName": "GPU-01", "active": true }
```

### 响应与错误

| 状态 | 含义 |
|---|---|
| `200` | 成功，返回创建/更新后的精简对象（含 `id`） |
| `400` | 请求格式无效（缺字段、类型错、时间非法） |
| `401` | 令牌缺失、畸形、伪造或已撤销 |
| `403` | 越权——令牌主人对目标项目/团队无权限 |
| `500` | 服务器错误，可重试 |

### 安全说明

- 令牌库中只存 sha256 hash，明文只在生成时返回一次，泄露即在设置页撤销。
- 外部写入一律不被信任：`token → userId → lib 权限校验`，越权由业务层拒绝。

### Claude Code 集成

项目内置 `.claude/skills/agilecampus/` skill，封装上述端点调用——配置好 `AGILECAMPUS_TOKEN` 与 `AGILECAMPUS_URL` 后，即可在 Claude Code 里用自然语言「给项目 X 加任务 Y」「把任务 Z 标记完成」「登记我占用了 GPU-01」。完整契约另见 [`docs/agent-api.md`](docs/agent-api.md)。

---

## 文档

- 设计与作战图：`docs/superpowers/`
- Agent 写入 API：`docs/agent-api.md`
- 技术债备案：`docs/BACKLOG.md`
