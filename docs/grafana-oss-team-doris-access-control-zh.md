# Grafana OSS 下的 Team 与 Doris 数据权限方案

## 背景

目前的临时方案是使用 Grafana Team 管理用户，为不同团队创建不同的 Doris 数据源，并让各数据源使用不同的 Doris 账号，以限制可访问的表。

这套思路可以继续使用，但需要补上一个前提：在 Grafana OSS 中，Team 不能作为数据源的安全边界。

## 结论

Grafana OSS 支持 Team，也支持按 Team 管理 Folder 和 Dashboard 权限，但不支持在同一个 Organization 内按 Team 限制数据源查询权限。

同一 Organization 中的用户默认可以查询该 Organization 下的所有数据源。即使插件页面只显示当前 Team 被分配的数据源，用户仍可能通过 Dashboard、Grafana API 或其他入口查询未显示的数据源。因此，前端隐藏或过滤数据源只能改善使用体验，不能作为访问控制。

如果继续使用 Grafana OSS，建议使用 Organization 隔离数据源，再由 Doris 负责表、列或行级权限：

```text
Team A 用户 -> Organization A -> Doris 数据源 A -> Doris 账号 A -> 允许访问的表
Team B 用户 -> Organization B -> Doris 数据源 B -> Doris 账号 B -> 允许访问的表
```

如果必须让多个 Team 共用一个 Organization，并直接按 Team 控制数据源查询权限，需要使用 Grafana Enterprise/Cloud，或者自行实现服务端授权层。

## Grafana OSS 的能力边界

| 能力                                       | Grafana OSS | 说明                                            |
| ------------------------------------------ | ----------- | ----------------------------------------------- |
| 创建 Team、手工维护成员                    | 支持        | 用户可以属于多个 Team                           |
| 按 Team 设置 Folder、Dashboard 权限        | 支持        | 适合管理页面和仪表盘访问                        |
| 创建多个 Doris/MySQL 数据源                | 支持        | 每个数据源可以使用不同的 Doris 账号             |
| 同一 Organization 内按 Team 限制数据源查询 | 不支持      | Data source permissions 属于 Enterprise/Cloud   |
| OIDC/LDAP 用户组自动同步到 Team            | 不支持      | Team Sync 属于 Enterprise/Cloud                 |
| 使用 Organization 隔离数据源               | 支持        | 数据源、Dashboard、Folder、Alert 等资源相互隔离 |

Grafana 官方文档说明，默认情况下，Organization 内的任意用户都可以查询其中的任意数据源。Viewer 也可以提交数据源支持的查询，并不限于已有 Dashboard 中保存的查询。关闭 Explore、隐藏数据源选择框或限制 Dashboard 可见范围都不能改变这一点。

## OSS 下的建议方案

### 1. 按访问范围划分 Organization

为每个需要独立数据权限的团队或租户创建一个 Organization。用户只加入其有权访问的 Organization；需要访问多个范围的用户，可以加入多个 Organization，并在 Grafana 中切换。

每个 Organization 单独维护以下资源：

-   Doris 数据源
-   Dashboard 和 Folder
-   Team
-   Alert 规则
-   Service Account

如果一个 Organization 只对应一个团队，Team 不是必需的；如果 Organization 内还有多组用户，可以继续用 Team 管理 Folder 和 Dashboard 权限。

Organization 方案的主要代价是配置会有一定重复。跨 Organization 共享 Dashboard、数据源和 Alert 不方便，建议通过 Grafana provisioning 管理，并使用 `orgId` 指定资源所属的 Organization。

### 2. 每个数据源使用独立的 Doris 只读账号

Grafana 的 SQL 数据源使用共享连接账号。一个数据源对应一个 Doris 服务账号，查询在 Doris 中体现为该服务账号，而不是最终登录 Grafana 的用户。

建议按权限集合创建 Doris Role，再把 Role 分配给数据源账号。例如：

```sql
CREATE ROLE grafana_team_a_reader;

GRANT SELECT_PRIV
ON internal.sales.orders
TO ROLE 'grafana_team_a_reader';

GRANT SELECT_PRIV
ON internal.sales.customers
TO ROLE 'grafana_team_a_reader';

CREATE USER 'grafana_team_a'@'10.0.0.20'
IDENTIFIED BY '<password>'
DEFAULT ROLE 'grafana_team_a_reader';
```

账号只授予查询所需的最小权限，不要使用 `root`、`admin` 或拥有写权限的业务账号。条件允许时，还应限制账号来源地址，并为连接启用 TLS。

表级权限不够时，可以继续使用 Doris 的列权限或 Row Policy。需要注意，Doris 权限限制的是某个数据源账号能查询什么，不能阻止同一 Grafana Organization 中的其他用户使用这个数据源。因此它仍需与 Organization 隔离或 Grafana Enterprise 的数据源权限配合。

## 当前插件实现需要注意的问题

当前插件已经根据用户所属 Team 过滤 MySQL 数据源列表，相关逻辑位于 `src/services/grafana-permissions.ts` 和 `src/hooks/useDatasourcePermissions.ts`。

这段逻辑运行在浏览器中，只影响 Doris App 页面展示，不会改变 Grafana 后端对数据源查询请求的授权结果。用户如果知道数据源 UID，仍可能绕过页面过滤直接发起查询。

另外，当前逻辑对“未加入任何 Team”的用户返回全部 MySQL 数据源。这是一个 fail-open 行为。即使后续改成默认不返回任何数据源，也只能修正页面行为，不能解决服务端授权问题。

如果要在 OSS 单一 Organization 中自行实现严格授权，需要调整查询链路：

1. 不再让浏览器直接查询普通 MySQL 数据源。
2. 查询统一经过 Doris App backend 或独立网关。
3. 服务端校验 Grafana 用户、Team 或 OIDC claims。
4. 服务端根据权限选择 Doris 凭据，并校验数据库、表和查询范围。
5. 确保用户无法绕过该入口访问底层数据源。

这实际上是在插件或网关中重新实现一套数据源权限系统，开发和安全审计成本都高于 Organization 隔离方案。

## 方案选择

| 场景                             | 建议                                                              |
| -------------------------------- | ----------------------------------------------------------------- |
| 接受多个 Organization            | 使用 Grafana OSS Organization 隔离，并在 Doris 中配置最小权限账号 |
| 必须使用单一 Organization        | 使用 Grafana Enterprise/Cloud 的 Data source permissions          |
| 必须使用 OSS 和单一 Organization | 开发服务端授权层，不依赖前端过滤                                  |
| 租户隔离或合规要求较高           | 使用独立 Grafana 实例，并同时配置 Doris 权限                      |

## 验收建议

权限方案上线前，至少验证以下场景：

-   Team A 用户无法看到或访问 Organization B。
-   Team A 使用的数据源无法查询未授权表、列或数据行。
-   直接调用 Grafana 数据源查询 API 也不能越权。
-   修改 URL 中的数据源 UID 后不能访问其他数据源。
-   未加入 Team 或 Organization 的用户默认没有数据访问权限。
-   Viewer、Editor、Organization Admin 和 Grafana Server Admin 的权限符合预期。
-   Doris 数据源账号只有必要的查询权限，无法执行建表、写入或删除操作。
-   用户跨 Team 或跨 Organization 调整后，旧权限能够及时撤销。

## 参考资料

-   [Grafana：Data source management](https://grafana.com/docs/grafana/latest/administration/data-source-management/)
-   [Grafana：Manage organizations](https://grafana.com/docs/grafana/latest/administration/organization-management/)
-   [Grafana：Manage teams with Grafana Teams](https://grafana.com/docs/grafana/latest/administration/team-management/)
-   [Grafana：Configure Team Sync](https://grafana.com/docs/grafana/latest/setup-grafana/configure-access/configure-team-sync/)
-   [Grafana：Provision Grafana](https://grafana.com/docs/grafana/latest/administration/provisioning/)
-   [Grafana：Configure the MySQL data source](https://grafana.com/docs/grafana/latest/datasources/mysql/configure/)
-   [Apache Doris：Built-in Authorization](https://doris.apache.org/docs/4.x/admin-manual/auth/authorization/internal/)
-   [Apache Doris：Data Access Control](https://doris.apache.org/docs/4.x/admin-manual/auth/authorization/data/)
