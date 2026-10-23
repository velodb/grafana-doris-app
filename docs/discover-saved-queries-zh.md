# Discover Saved Queries

Saved Queries 将 Discover 当前查询现场保存到 Grafana 主机，供同一组织的成员在不同浏览器加载。数据源、库表、查询模式、查询文本、筛选、时间范围、时区、选中列、列顺序和排序都会保存。结果数据、列宽、页面布局、分页位置和 Top N 不会保存。

## 使用

1. 在 Discover 输入查询、选择 Application 或设置筛选；不必先执行查询。
2. 点击 Query 右侧的保存图标（**Save query**），填写名称和可选描述。名称可以重复。
3. 点击 Query 右侧的文件夹图标（**Saved queries**）打开右侧列表，按名称搜索并选择条目。
4. 加载会替换当前现场。存在未保存修改时会先提示确认；所有必要元数据就绪后自动查询。
5. 再次点击保存图标，在弹窗中选择 **Update current query** 更新当前条目，或 **Save as new query** 另存。只有具备维护权限时才提供更新选项；查询、名称和描述都未修改时不能提交更新。图标提示显示当前查询名称，角标表示未保存修改。列表提供 **Rename** 和 **Delete**。

相对时间（如最近一小时）在每次加载时重新计算；绝对时间保持固定。分享链接仍然携带当前现场快照，不会引用 Saved Query 的最新版本。刷新页面可恢复 URL 中的现场，但不保留当前 Saved Query 的编辑关联。

若目标数据源、库表、时间字段、筛选字段或排序字段不可用，加载失败并暂停自动查询，不会改查其他表或删除筛选。缺失的展示列会被跳过并显示提示。JSON/VARIANT 的显式路径可在采样或扩展 DESC 中缺失，因此在物理根列仍为结构化类型时保留原路径。可以修正数据源选择，重新加载其他查询，或点击 **Keep current query** 明确继续使用原现场。

## 共享和权限

同一 Grafana 组织的成员可以看到保存的查询文本与筛选值。Viewer 只能查看和加载；Editor 可创建并维护自己创建的条目；组织 Admin 可以维护所有条目。保存查询不会授予数据源或数据库访问权限，实际查询始终使用加载者的现有权限。

作者使用 Grafana 传入的组织和登录名识别。登录名变更后，旧条目需要组织 Admin 维护；第一版没有所有权转移或私有条目。

同时编辑时，服务端会校验 revision。出现冲突后不会覆盖他人的修改，弹窗会保留输入；关闭弹窗并重新加载最新条目后再保存。

## 部署

插件包含两个独立后端：App 后端管理 Saved Queries，嵌套的 Doris 数据源后端执行数据查询。先构建前端，再构建后端：

```sh
yarn build
mage buildAll
```

发布包根目录需要包含 `velodb-doris-app_<os>_<arch>`；`datasource/` 下保留 `velodb-doris-datasource_<os>_<arch>`。`mage buildAll` 会生成当前主机、Linux amd64 和 Linux arm64 的两个后端。升级插件后需重启 Grafana，让它发现新增加的 App 后端。

SQLite 默认保存在 `/var/lib/grafana/doris-app/saved-queries.db`，也可通过环境变量指定绝对路径：

```yaml
environment:
  DORIS_APP_STORAGE_PATH: /var/lib/grafana/doris-app/saved-queries.db
  GF_PLUGINS_FORWARD_HOST_ENV_VARS: velodb-doris-app,velodb-doris-datasource
volumes:
  - saved-queries:/var/lib/grafana/doris-app
```

在 Compose 顶层声明 `saved-queries` named volume；仓库的开发环境与 `test-env/docker-compose.yaml` 已包含持久卷配置。启用宿主环境过滤的 Grafana 版本需要将 App 插件加入 `GF_PLUGINS_FORWARD_HOST_ENV_VARS`，已有 Doris SSO 环境配置应一并保留。生产部署需保证存储目录归 Grafana 运行用户所有且可写，建议权限为 `0700`。不要把数据库放进插件安装目录。

数据库首次使用时自动创建表，启用 WAL、事务和 5 秒锁等待。目录不可写或磁盘故障时，Saved Queries 返回不可用提示，Discover 查询和分享链接仍然可以使用；修复存储后可以重试。备份时使用 SQLite backup API，或停止 Grafana 后备份整个存储目录，避免只复制正在使用的 `.db` 而遗漏 WAL。

此存储方案面向单 Grafana 实例，不支持多个 Grafana 副本共享写入同一 SQLite 文件。数据保留在持久卷中；`docker compose down -v` 会删除卷及其中的查询。

## 接口

前缀为 `/api/plugins/velodb-doris-app/resources/saved-queries`。支持列表 GET（`search`、`page`、`pageSize`，默认每页 20、最多 100）、按 ID GET、新建 POST、按 ID PUT 和 DELETE。PUT 可以更新名称、描述或状态；PUT 和 DELETE 必须携带当前 `revision`。名称去除首尾空白后为 1–120 个字符，描述最多 2000 个字符，请求最多 1 MiB。

服务端从 Grafana 插件上下文获取组织和身份，不接受客户端指定作者、组织或权限。请求不支持的状态版本返回 400，无权限返回 403，条目不存在或不属于当前组织返回 404，并发冲突返回 409，存储故障返回 503。
