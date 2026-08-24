# Grafana 告警接入飞书 Webhook

本文介绍如何将 Grafana Alert 告警发送到飞书群。本文以飞书群自定义机器人为例，适用于本项目的 Doris 日志告警。

## 重要说明

Grafana Webhook 和飞书群机器人 Webhook 的请求格式不同：

- Grafana 发送 Grafana Alert JSON，包含 `status`、`alerts`、`labels` 和 `annotations` 等字段。
- 飞书群机器人要求 `msg_type` 和 `content` 等固定字段。

因此，Grafana 通常不能直接把飞书机器人地址配置为 Contact Point。推荐使用以下链路：

```text
Grafana → Webhook 转换服务 → 飞书群自定义机器人
```

转换服务可以是已有告警网关、n8n、Serverless Function 或内部 HTTP 服务。

## 前置条件

- Grafana Alerting 已启用。
- Grafana 数据源已经配置并通过 `Save & test`。
- Grafana Server 可以访问转换服务。
- 转换服务可以访问 `open.feishu.cn`。
- 已创建一个飞书群，并拥有添加群机器人的权限。

本项目中的示例日志表为 `otel.otel_logs`，常用字段包括：

```text
timestamp
service_name
severity_number
severity_text
body
```

## 1. 创建飞书群自定义机器人

进入需要接收告警的飞书群：

```text
群设置 → 群机器人 → 添加机器人 → 自定义机器人
```

填写机器人名称，例如：

```text
Grafana Alert
```

安全设置建议先选择关键词：

```text
Grafana
```

创建完成后复制 Webhook 地址，格式类似：

```text
https://open.feishu.cn/open-apis/bot/v2/hook/xxxxxxxx
```

该地址包含访问凭据，不要提交到 Git、工单或公开文档中。

飞书官方文档：

- [自定义机器人使用指南](https://open.feishu.cn/document/ukTMukTMukTM/ucTM5YjL3ETO24yNxkjN)

## 2. 单独测试飞书机器人

将下面命令中的地址替换为实际 Webhook 地址：

```bash
curl -X POST \
  -H "Content-Type: application/json" \
  -d '{"msg_type":"text","content":{"text":"Grafana test alert"}}' \
  'https://open.feishu.cn/open-apis/bot/v2/hook/你的TOKEN'
```

成功后，飞书群应收到：

```text
Grafana test alert
```

如果这一步失败，不要继续配置 Grafana，先检查飞书机器人、Webhook 地址和关键词安全设置。

## 3. 配置 Webhook 转换服务

转换服务需要提供一个 HTTP 接口，例如：

```text
POST http://webhook-adapter:8080/grafana
```

它接收 Grafana 请求：

```json
{
  "status": "firing",
  "commonLabels": {
    "alertname": "Doris error logs detected",
    "service": "doris",
    "severity": "warning"
  },
  "commonAnnotations": {
    "summary": "Doris received ERROR logs"
  },
  "alerts": []
}
```

然后转换并转发为飞书格式：

```json
{
  "msg_type": "text",
  "content": {
    "text": "【Grafana 告警】\n状态：firing\n告警：Doris error logs detected\n服务：doris\n级别：warning\n摘要：Doris received ERROR logs"
  }
}
```

转换服务至少需要完成以下工作：

1. 接收 `POST` 请求。
2. 解析 Grafana Alert JSON。
3. 从 `status`、`commonLabels`、`commonAnnotations` 和 `alerts` 中提取内容。
4. 使用飞书机器人 Webhook 地址发送 `POST` 请求。
5. 返回 HTTP 2xx，避免 Grafana 将通知标记为失败。

飞书机器人请求必须包含：

```http
Content-Type: application/json
```

## 4. 在 Grafana 中创建 Contact Point

进入：

```text
Alerting → Notification configuration → Contact points
```

点击 `New contact point`，填写：

```text
Name: Doris Alerts Feishu
Integration: Webhook
URL: http://webhook-adapter:8080/grafana
HTTP Method: POST
```

如果转换服务需要鉴权，可以配置：

```text
Authentication Header Scheme: Bearer
Authentication Header Credentials: <转换服务 Token>
```

点击：

```text
Test → Send test notification
```

确认飞书群收到测试消息后保存 Contact Point。

注意：如果 Grafana 运行在 Docker 中，`localhost` 指向 Grafana 容器自身，不是宿主机。转换服务和 Grafana 在同一个 Compose 网络时，优先使用服务名，例如：

```text
http://webhook-adapter:8080/grafana
```

如果转换服务运行在宿主机，Docker Desktop 通常可以使用：

```text
http://host.docker.internal:8080/grafana
```

## 5. 将 Contact Point 绑定到告警规则

创建或编辑 Alert Rule，在 `Configure notifications` 中选择：

```text
Select contact point
Contact point: Doris Alerts Feishu
```

也可以使用 Notification Policy 按标签路由，例如：

```text
severity = warning  → Doris Alerts Feishu
service = doris      → Doris Alerts Feishu
```

建议为规则设置以下 Labels：

```text
team: observability
service: doris
severity: warning
```

建议设置以下 Annotations：

```text
summary: Doris received ERROR logs
description: An ERROR log was detected in Doris within the last five minutes
```

## 6. 使用 Doris 日志规则验证

数据源选择 Doris/MySQL，查询格式选择 `Time series`，使用：

```sql
SELECT
  NOW() AS time,
  COUNT(IF(severity_number >= 17, 1, NULL)) AS error_count
FROM otel.otel_logs
WHERE timestamp >= NOW() - INTERVAL 5 MINUTE
```

配置表达式：

```text
B: Reduce
Input: A
Function: Last

C: Threshold
Input: B
Condition: Is above 0
```

确认 `C` 是 `Alert condition`，并将告警规则绑定到 `Doris Alerts Feishu`。

测试时可以写入一条 ERROR 日志：

```sql
INSERT INTO otel.otel_logs (
  timestamp,
  service_name,
  severity_number,
  severity_text,
  body
)
VALUES (
  NOW(),
  'alert-test',
  17,
  'ERROR',
  'Grafana alert test'
);
```

设置 `Pending period = 0s`、`Evaluation interval = 1m` 时，通常等待一个评估周期即可看到告警进入 `Firing`。

## 7. 排查方法

### 飞书机器人测试失败

- 检查 Webhook 地址是否完整。
- 检查机器人是否仍在目标群中。
- 检查安全关键词是否出现在消息内容中，例如 `Grafana`。
- 检查是否误用了应用机器人 API 地址。

### Grafana Contact Point 测试失败

- 确认 Grafana 容器能访问转换服务。
- 不要在容器中使用错误的 `localhost` 地址。
- 检查转换服务是否返回 HTTP 2xx。
- 检查转换服务日志中是否收到 Grafana 请求。

### 告警 Firing，但飞书没有消息

- 确认规则绑定了正确的 Contact Point。
- 检查 Notification Policy、Mute Timing 和 Silence。
- 检查转换服务是否正确读取 Grafana 的 `status`、Labels 和 Annotations。
- 检查转换服务是否将内容转换成飞书要求的 `msg_type` 和 `content` 格式。

### Docker 中查看 Grafana 日志

```bash
docker logs -f velodb-grafana-app-test
```

### Kubernetes 中查看 Grafana 日志

```bash
kubectl logs -l app.kubernetes.io/component=grafana -n ai-observe-stack
```

## 安全建议

- 不要把飞书 Webhook Token 提交到代码仓库。
- 转换服务应增加鉴权，至少使用 Bearer Token。
- 生产环境可以启用飞书机器人签名校验。
- 限制转换服务的来源和访问范围。
- 告警内容不要直接包含密码、Token 或敏感日志正文。
