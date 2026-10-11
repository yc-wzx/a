# AgileCampus 国内连接故障排查与阿里云工单

记录时间：2026-10-11，北京时间。当前国内免代理访问尚未恢复；本文用于提供已完成的检查和技术支持所需信息，不代表故障已经解决。

## 已确认的结果

- 实例：中国香港轻量应用服务器，`a867d2aec49449bf9c43ee0b696670fc`，公网 IP `47.242.210.133`。
- 网站：<https://agilecampus-47-242-210-133.sslip.io>，域名正确解析到上述 IP。
- 负责人反馈：电脑经代理可打开，关闭代理的校园网络及手机流量无法打开。
- 控制台截图：TCP 22、80、443 及 ICMP 规则均启用，来源均为 `0.0.0.0/0`。
- 服务器内部检查：UFW inactive，INPUT/OUTPUT 为 ACCEPT，DOCKER-USER 没有自定义规则，Docker 已允许并转发公开 80/443，路由和策略路由未发现来源限制。数据库仍仅在容器内网，应用宿主入口仍为 `127.0.0.1:3080`。
- 应用、数据库、提醒和 HTTPS 代理均正常，独立公网健康检查返回 `{"ok":true}`，HTTPS 证书可信。此次没有更改防火墙或数据库。

北京时间 **12:18–12:19**，Globalping 的 8 个独立 HTTPS 测试节点结果如下：

| 网络 | 城市 | 结果 |
|---|---|---|
| 电信 AS4134 | 广州、南京 | 2/2 TCP 连接超时 |
| 联通 AS4837 | 长沙、南宁 | 2/2 TCP 连接超时 |
| 移动 AS9808 | 昆明、北京 | 2/2 TCP 连接超时 |
| 香港对照 | 香港 | HTTP 200，TLS 证书校验通过 |
| 美国对照 | Buffalo | HTTP 200，TLS 证书校验通过 |

上述国内节点均正确解析到 `47.242.210.133`，失败发生在 TCP 建连阶段，尚未进入 TLS 握手；因此本轮故障不能通过修改登录逻辑或重新签发证书来解决。

独立 IP ping 测试同样为国内 6/6 节点 100% 丢包，香港和美国节点 0% 丢包。TCP 443 的 MTR 测试中，三个国内节点均没有收到最终目标回应，香港节点到达目标。中间路由器可能不回应探测报文，不能仅凭中间跳超时认定某台设备就是故障点。

公开结果保存于[结构化验证记录](verification/20261011-network.json)。原始 Globalping API 报告可能有保存期限，本文及仓库中的记录用于留存结果：

- [HTTPS 测试原始结果](https://api.globalping.io/v1/measurements/26nhxC2pZyuzDMkWM00021ILi)
- [IP ping 原始结果](https://api.globalping.io/v1/measurements/2kDY7DKFxKYDJJutI00021ILi)
- [TCP 443 MTR 原始结果](https://api.globalping.io/v1/measurements/2mh0vmjM0ebybNrps00021ILk)
- [服务器内部规则与状态检查](https://github.com/yc-wzx/agilecampus/actions/runs/38111287444)

**目前结论：存在明确的内地访问失败、境外访问正常的差异。** 应用和已检查的防火墙没有发现对应故障；具体是否为平台侧防护、进出方向路由或运营商链路，尚需阿里云核查。不能据此保证更换域名、重启系统或换一个香港实例就会恢复。

## 可以直接提交给阿里云的内容

**标题：香港轻量服务器公网 IP 内地三网均无法连接，境外正常，请排查**

中国香港轻量应用服务器：

- 实例 ID：`a867d2aec49449bf9c43ee0b696670fc`
- 实例名称：`Ubuntu-eqxp`
- 公网 IP：`47.242.210.133`
- 系统：Ubuntu 24.04
- 检测地址：`https://agilecampus-47-242-210-133.sslip.io/api/health`
- 检测时间：2026-10-11 12:18–12:21，北京时间

问题现象：校园网络和手机流量均无法直接打开网站；经境外代理可打开。Globalping 电信、联通、移动各 2 个节点共 6 个节点 DNS 解析正确，但 TCP 443 建连均超时；香港及美国对照节点返回 HTTP 200，证书校验正常。IP ping 在国内 6 个节点均为 100% 丢包，境外对照正常。

已检查：控制台 TCP 22/80/443 及 ICMP 全部启用，来源均为 0.0.0.0/0。服务器 80/443 正常监听；UFW inactive；未发现来源网段限制，Docker 80/443 转发正常，应用和数据库健康。

请核查该公网 IP 的内地可达性、平台侧防护/封禁/黑洞状态，以及进出方向路由和运营商链路，并协助恢复国内正常访问。我们是高校课程项目，2026-10-14 需要向老师展示，目标是国内用户无需代理访问。请在保留现有系统及数据库的前提下提供处理方案。如当前资源无法恢复，请说明原因与可选处理方式。

附件可提供防火墙截图、本文件及上述检测结果；不需要提供数据库密码、SSH 私钥或 `.env`。

本文仅准备工单内容，尚未替用户提交工单或联系客服。

## 官方说明

阿里云建议先核对防火墙来源和云安全拦截，并在常规排查无果后提交工单。见[特定 IP 无法访问](https://help.aliyun.com/zh/simple-application-server/support/my-simple-application-server-cannot-be-accessed-from-specific-ip-addresses)和[远程连接常见问题](https://help.aliyun.com/zh/simple-application-server/user-guide/faq-about-remote-connection)。

轻量应用服务器公网 IP 按官方限制不支持更换，不能把“直接在控制台换 IP”作为确定可执行的步骤。见[使用限制](https://help.aliyun.com/zh/simple-application-server/product-overview/limits)。
