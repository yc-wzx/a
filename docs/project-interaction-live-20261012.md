# 项目三视图与导航上线验收

2026-10-12 20:48（北京时间）已发布到 [AgileCampus](https://weidu-agilecampus.pw)。[PR #30](https://github.com/yc-wzx/agilecampus/pull/30) 合入团队仓库，落实已确认的候选 1、2、3、5。

## 已上线

任务看板、列表、甘特图共用筛选及单例详情；项目概览提供真实成员工作量及成员任务跳转；当前浏览器可保存、应用、改名和删除常用筛选；项目入口改为分组侧栏，教程同步说明操作。具体使用方法及开源借鉴见 [功能说明](project-interaction-20261012.md)。

常用筛选按账号和项目隔离，仅当前浏览器保留，不跨设备同步；工作量是任务数量，主子任务分别计数，不是贡献评分，也不读取私人课表。

## 发布核对

| 项目 | 结果 |
| --- | --- |
| 源码版本 | `f4336579cbb48f6a361a82c72972371841ecaef9` |
| 应用／迁移镜像 | `agilecampus:release-f4336579cbb4`／`agilecampus:migrate-f4336579cbb4` |
| Linux 构建 | [GitHub Actions 成功](https://github.com/yc-wzx/agilecampus/actions/runs/38250138807)，本地和服务器均核对版本与 SHA-256 |
| 数据库 | 原数据库容器保留；16 条迁移不变，没有新增结构迁移 |
| 数据数量 | 发布前后用户 16、项目 9、任务 8；含此前明确标注的验收示例，本轮复用它们 |
| 配置 | AI 加密主密钥、登录／提醒／数据库密钥及域名配置逐项一致，未输出秘密值 |
| 服务 | 应用和数据库健康，无 OOM；提醒运行；Cloudflare 服务正常，4 个就绪连接 |
| 发布前数据库备份 | `/opt/agilecampus/backups/agilecampus-2026-10-12T12-48-10-838Z.dump` |
| 配置和旧发布记录备份 | `/opt/agilecampus/backups/project-interaction-release-20261012`，仅维护人员使用 |
| 代码回退版本 | 保留上一版 `agilecampus:release-a380dc80a4be`；代码回退不会恢复数据库 |

## 验证与边界

- 完整测试 698 项通过、2 项跳过；TypeScript、Linux 生产构建通过，ESLint 无错误（1 条原有测试警告）。
- [本地电脑交互 10 项](verification/20261012-project-interaction-local.json)通过。项目间常用筛选隔离在本地额外使用第二个既有示例项目验证。
- [线上新增交互 9 项](verification/20261012-project-interaction-production.json)通过：分区与路由定位、列表排序、筛选保存／刷新／改名／应用／删除、单例详情、甘特、旧时间线地址、成员工作量及任务跳转、1366／1440 桌面宽度、非成员隔离，无浏览器运行异常。
- [线上既有业务回归 24 项](verification/20261012-project-interaction-production-core.json)通过：HTTPS 与数据库健康、登录、任务持久化、私有事件隔离、18 个原有页面、日历导出、第二账号越权拒绝。
- 线上两组共 33 项检查，经当前自动化电脑的既有代理执行；不能作为新的校园网关闭代理实测。Cloudflare 固定入口沿用原配置，没有重置域名或隧道。
- 检查复用既有验收账号及项目，没有新建生产账号、项目或任务；保存和删除视图只作用于测试浏览器。截图仅是验收示例，不能作为唯笃队真实进度或真实同学试用反馈。
- 没有执行付费 AI 调用。本轮只检查电脑网页。

进入项目后刷新即可看到新版；账号、任务、成果与个人 AI 配置继续保留。
