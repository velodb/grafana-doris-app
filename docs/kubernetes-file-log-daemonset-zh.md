# Kubernetes 文件日志采集（DaemonSet）

本文说明如何为写入容器内固定文件路径的应用采集日志，并自动补充 Pod 名称、Pod IP、Namespace、Container 和 Pod Labels。方案使用每个节点一个 OpenTelemetry Collector DaemonSet，不为每个业务 Pod 部署 Sidecar。

对应部署清单：[k8s-filelog-daemonset.yaml](../k8s-filelog-daemonset.yaml)。

## 适用场景

- 应用将日志写到文件，例如 `/app/logs/application.log`，而不是仅写入 stdout/stderr。
- 希望采集文件日志时带上 Kubernetes 元数据。
- 集群中应用数量较多，不适合为每个 Pod 额外运行一个 Collector Sidecar。

## 架构

```text
业务 Pod 的应用容器
  └── 写入共享 hostPath 日志目录
        /var/log/application/<namespace>/<pod-uid>/<pod-name>/<container-name>/application.log
  └── 节点上的 OTel Collector DaemonSet
        ├── 从文件路径提取 Pod UID
        ├── 通过 Kubernetes API 查询 Pod
        └── 补充 Pod 元数据并发送至 Gateway
              └── 中心 OTel Collector / 日志存储
```

DaemonSet 的资源消耗按节点数计算。例如 20 个节点只运行 20 个采集器，而不是为 1200 个应用运行 1200 个 Sidecar。

## 日志目录约定

每一个业务 Pod 的日志必须写到以下目录结构：

```text
<日志根目录>/<namespace>/<pod-uid>/<pod-name>/<container-name>/<日志文件>
```

默认日志根目录是 `/var/log/application`，完整示例：

```text
/var/log/application/payment/8c4f7b4a-1234-4567-89ab-123456789abc/payment-6f7bc94d88-9mczf/app/application.log
```

其中 Pod UID 是关联 Kubernetes 元数据的关键。Pod 名称和 IP 都可能变化，UID 可以唯一标识一个具体的 Pod 实例。

## 改造业务工作负载

应用仍可继续写入原来的容器路径，例如 `/app/logs`。使用 `hostPath` 卷与 `subPathExpr` 将该路径映射到带 Pod 身份的节点目录：

```yaml
spec:
  containers:
    - name: app
      env:
        - name: POD_UID
          valueFrom:
            fieldRef:
              fieldPath: metadata.uid
        - name: POD_NAME
          valueFrom:
            fieldRef:
              fieldPath: metadata.name
        - name: POD_NAMESPACE
          valueFrom:
            fieldRef:
              fieldPath: metadata.namespace
      volumeMounts:
        - name: application-logs
          mountPath: /app/logs
          subPathExpr: $(POD_NAMESPACE)/$(POD_UID)/$(POD_NAME)/app
  volumes:
    - name: application-logs
      hostPath:
        path: /var/log/application
        type: DirectoryOrCreate
```

`app` 是上述 Pod 中的容器名。多容器 Pod 应为每个容器使用不同的最后一级目录，避免不同容器写入同一文件。

## 部署 Collector

1. 编辑 [k8s-filelog-daemonset.yaml](../k8s-filelog-daemonset.yaml) 中的 `otel-filelog-agent-settings`：

   - `LOG_ROOT`：节点日志根目录，必须与业务 Pod 的 `hostPath` 一致。
   - `OTEL_GATEWAY_ENDPOINT`：中心 Gateway 的 OTLP/HTTP 地址；填写根地址，例如 `http://otel-collector-gateway.observability.svc.cluster.local:4318`，不要附加 `/v1/logs`。

2. 确认 DaemonSet 的两个 `hostPath` 与配置一致：

   - `/var/log/application`：只读挂载业务日志；若修改 `LOG_ROOT`，这里也必须同步修改。
   - `/var/lib/otelcol/filelog`：保存读取位置，避免 Collector 重启后重复读取大量历史日志。

3. 部署：

   ```bash
   kubectl apply -f k8s-filelog-daemonset.yaml
   kubectl rollout status daemonset/otel-filelog-agent -n observability
   ```

## 采集到的元数据

Collector 从路径中提取 Pod UID，使用 Kubernetes API 关联 Pod 后，日志资源属性会包含：

```text
k8s.namespace.name
k8s.pod.name
k8s.pod.uid
k8s.pod.ip
k8s.node.name
k8s.container.name
```

清单默认还会采集所有 Pod Labels。生产环境应评估标签基数和敏感信息；如只需要少数标签，请将 `k8sattributes.extract.labels` 改为明确的允许列表，例如：

```yaml
labels:
  - tag_name: team
    key: team
    from: pod
  - tag_name: app_name
    key: app.kubernetes.io/name
    from: pod
```

## 验证

确认 DaemonSet 在每个节点运行：

```bash
kubectl get daemonset -n observability otel-filelog-agent
kubectl get pods -n observability -l app.kubernetes.io/name=otel-filelog-agent -o wide
```

查看 Collector 是否有读取或转发错误：

```bash
kubectl logs -n observability -l app.kubernetes.io/name=otel-filelog-agent -c otel-collector --tail=200
```

在 Gateway 或日志存储中按 `k8s.pod.uid`、`k8s.pod.name` 或业务日志内容查询，确认日志同时具备 Kubernetes 属性。

## 运行与容量建议

- 清单默认每个节点请求 `100m CPU / 128Mi` 内存，上限为 `512Mi`；应按单节点日志量压测后调整。
- 高日志量节点需要重点关注 Collector 的内存、导出队列、Gateway 吞吐和日志存储写入能力。
- `start_at: end` 表示首次部署时只采集新日志。若需要回补历史日志，改为 `start_at: beginning`，并先评估历史日志量。
- Gateway 或存储端不可用时，Collector 会有限时间重试；生产环境应结合可接受的数据丢失窗口设置队列和重试策略。

## 已验证内容与边界

本方案已在本机 Kubernetes 环境验证：文件日志可被 DaemonSet 读取，日志路径中的 Pod UID 能成功关联 Kubernetes API，并得到 Pod IP、Pod 名称、Namespace、容器名称和 Pod Labels。

本机 Doris 存储端当时存在缺失分区和不可用 BE 副本的问题，导致未完成存储落库验证；该问题不影响 DaemonSet 的文件读取、元数据关联和向 OTLP Gateway 的转发能力。上线前仍应在目标环境完成 Gateway 与存储端的端到端验收。
