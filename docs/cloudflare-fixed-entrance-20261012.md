# 唯笃队 AgileCampus 固定访问入口与维护

更新：2026-10-12。正式网站：[https://weidu-agilecampus.pw](https://weidu-agilecampus.pw)。从 [登录页](https://weidu-agilecampus.pw/login) 选择「去注册」，使用自己的账号。腾讯文档团队项目主页独立保留。

## 已经完成的配置

域名已在 Cloudflare Free 激活，阿里云域名的名称服务器为 `meg.ns.cloudflare.com`、`rob.ns.cloudflare.com`。网站使用名为 `weidu-agilecampus` 的正式 Cloudflare Tunnel。访问经过 Cloudflare HTTPS → 香港服务器的出站隧道 → `127.0.0.1:3080` → 现有应用。数据库仍位于服务器 Docker 内网。

上午的这次入口配置只更新访问入口及运行配置。当时应用为 `agilecampus:release-8424e13465c9`，数据库容器未更换，数据库密码、登录密钥和提醒密钥保持原值，没有执行迁移或清库。`AUTH_URL` 与 `AGILECAMPUS_URL` 均为新域名，登录回调不再跳回旧入口。下午已另行发布教程、删除和个人 AI 功能；19:33 发布工作台改进，20:48 发布项目三视图、工作量、常用筛选及侧栏，当前版本见 [项目交互上线验收](project-interaction-live-20261012.md)。下方访问证据保留原测试时间。

| 项目 | 实际配置 |
|---|---|
| 隧道程序 | 官方 cloudflared `2026.10.0`，固定版本，不自动更新 |
| 服务 | `agilecampus-cloudflared.service`，已启用开机启动与失败重启 |
| 程序目录 | `/opt/agilecampus-cloudflared` |
| 非敏感配置 | 上述目录中的 `config.yml`，见仓库 [配置模板](../deploy/cloudflared.config.example.yml) |
| 运行凭据 | `/etc/agilecampus-cloudflared/tunnel.json`，root 可读，由 systemd 传给动态服务用户；不能发群、截图或提交仓库 |
| 服务模板 | [agilecampus-cloudflared.service](../deploy/agilecampus-cloudflared.service) |
| 连接检查 | `http://127.0.0.1:3085/ready`，仅服务器本机可访问 |
| 原入口 | sslip.io 域名及 IP 的健康检查保留，其他 HTTPS 路径跳转新域名 |
| 配置备份 | `/opt/agilecampus/backups/cf-entrance-20261012`，包含私密 `.env`，仅维护人员使用 |

正式服务没有临时入口的八小时运行限制。原 `trycloudflare.com` 试用入口及预览容器已经停止，以后发固定域名。账户级授权证书已从服务器移除，保留启动这一条隧道所需的运行凭据；以后创建其他隧道或修改 DNS 时需重新授权。

## 访问与功能验证

不同网络分别记录，不能把使用代理的功能检查当成免代理访问。

| 检查 | 2026-10-12 实际结果 |
|---|---|
| 负责人校园网电脑关闭代理 | 用户确认可以看到新域名登录页；尚未代替完整真实试用 |
| 电信：东莞、南京 | 两个独立节点 HTTPS 200，证书可信 |
| 联通：南宁、长沙 | 两个独立节点 HTTPS 200，证书可信 |
| 移动：北京、武汉 | 两个独立节点 HTTPS 200，证书可信 |
| 香港、美国对照 | 两个独立节点 HTTPS 200，证书可信 |
| 当前自动化电脑直接访问 | Edge 到健康接口超时，Node HTTP 请求连接重置；此网络没有记为直连通过 |
| 当前自动化电脑使用既有代理 | 30 项电脑网页功能检查通过，无页面异常 |

30 项包括注册登录、创建私有团队和课程项目、分配任务、刷新后保存、私有临时事件及默认不共享、团队页面隐藏私人事件、生成和确认规则短期计划、主要页面、日历导出、第二账号越权拒绝。数据明确标记为「部署验收示例」，不代表团队每周进展。证据见 [结构化验证记录](verification/20261012-cloudflare-fixed.json)。

六个国内节点的请求耗时约 0.5–8.2 秒；部分线路仍慢，不保证所有学校或运营商网络始终可达。新固定入口可用，也不表示原香港 IP 的国内直连故障已修好。真实 AI 和飞书仍未配置，不计作通过；本轮只验电脑网页。

## HTTPS 与维护

固定域名的浏览器证书由 Cloudflare 管理。当前证书有效期至 2027-01-10 11:17（北京时间），后续自动续期仍需持续核对。隧道在同一服务器通过本机 HTTP 连接应用；不要为此把数据库或 3080 端口开放到公网，也不用把 Cloudflare SSL 模式改成 Flexible。

下面的命令在阿里云 Workbench 的**服务器终端**运行：

```bash
sudo systemctl status agilecampus-cloudflared.service --no-pager
curl --fail http://127.0.0.1:3085/ready
curl --fail https://weidu-agilecampus.pw/api/health
sudo /opt/agilecampus-runtime/node/bin/node /opt/agilecampus/scripts/ops.mjs status
```

`readyConnections` 大于 0 表示隧道已连接；公网健康响应应为 `{"ok":true}`。隧道异常时先查看日志，然后重启这一项服务：

```bash
sudo journalctl -u agilecampus-cloudflared.service -n 60 --no-pager
sudo systemctl restart agilecampus-cloudflared.service
```

已实际执行服务重启，重连后公网健康检查通过；这是服务重启验证，没有重启整台服务器。Cloudflare Tunnel 不承载 SSH，网站正常不能说明 SSH 的原网络问题已经消失；维护仍可用阿里云 Workbench。

继续使用原来的预构建应用发布、备份与独立恢复流程，见 [部署与恢复方案](aliyun-deployment.md)。保留 `.env` 中当前的 `APP_IMAGE`、`MIGRATE_IMAGE`、固定域名和秘密配置，不把模板整份覆盖进去。升级应用前备份，不运行 `down -v`。

若需恢复原入口，先在私有终端核对备份与现用镜像；备份中的旧 `.env` 没有镜像标签，必须补回当前发布记录中的 `APP_IMAGE`、`MIGRATE_IMAGE` 再重建 app、reminders、edge，数据库不动。恢复到旧入口仍可能遇到原国内网络故障，不能作为默认修复办法。

Cloudflare 参考：[正式本地管理隧道](https://developers.cloudflare.com/tunnel/features/locally-managed-tunnels/create-local-tunnel/)、[配置文件](https://developers.cloudflare.com/tunnel/features/locally-managed-tunnels/configuration-file/)、[凭据权限](https://developers.cloudflare.com/tunnel/features/locally-managed-tunnels/tunnel-permissions/)。
