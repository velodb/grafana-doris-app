# Doris SSO Datasource 使用指南

本指南说明如何让用户通过公司的标准 OIDC 登录 Grafana，并以各自的身份查询 Doris。用户不需要 Doris 密码，也不需要在 Datasource 中填写私钥或 JWKS 地址。

## 先理解三类角色

| 谁                        | 负责什么                                                                                                                                  |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| 部署管理员                | 在 Grafana 部署中配置一次 Doris SSO Profile、暴露 JWKS、开启 Doris TLS/OIDC。                                                             |
| Grafana Datasource 管理员 | 创建 Datasource，配置 Doris 连接、OIDC issuer/audience，以及用于生成 Doris role mapping SQL 的 OIDC group 规则；由 Doris 管理员执行 SQL。 |
| 普通用户                  | 用公司的 OIDC 账号登录 Grafana，选择已授权 Datasource 后直接查询或使用 Discover。                                                         |

身份与权限的实际链路是：

```text
OIDC 登录用户和 groups
        ↓
Grafana 转发 ID Token
        ↓
Doris Datasource 校验上游身份，并签发 5 分钟 Doris token
        ↓
Doris 根据 doris_groups 授予 Doris role
```

## 一次性部署配置

这一步由部署管理员完成一次；同一个 Grafana 部署的所有 Doris Datasource 共用它。

1. 生成 RSA 私钥，并以 Secret 文件挂载到每个 Grafana 副本。例如：

    ```bash
    openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:3072 -out /run/secrets/velodb-doris-sso.pem
    chmod 600 /run/secrets/velodb-doris-sso.pem
    ```

2. 为 Grafana 配置下列环境变量。`JWKS_PUBLIC_URL` 必须是 Doris FE 可以访问的 HTTPS 地址；它反向代理到插件的 listener。

    ```bash
    VELODB_DORIS_SSO_SIGNING_KEY_FILE=/run/secrets/velodb-doris-sso.pem
    VELODB_DORIS_SSO_ISSUER=https://grafana.example.com/doris-sso
    VELODB_DORIS_SSO_JWKS_PUBLIC_URL=https://grafana.example.com/doris-sso/.well-known/jwks.json
    VELODB_DORIS_SSO_JWKS_LISTEN_ADDR=:8999
    VELODB_DORIS_SSO_SIGNING_KEY_ID=velodb-doris-sso
    GF_PLUGINS_FORWARD_HOST_ENV_VARS=velodb-doris-datasource
    ```

    `VELODB_DORIS_SSO_ALLOW_INSECURE_HTTP=true` 仅限本地开发，生产环境不要设置。

    如果通过 ZIP 或本地目录安装的是未签名版本，还必须允许 App 和其内置 Datasource 两个插件 ID：

    ```bash
    GF_PLUGINS_ALLOW_LOADING_UNSIGNED_PLUGINS=velodb-doris-app,velodb-doris-datasource
    ```

    Grafana 会分别校验这两个 ID。若只允许 `velodb-doris-app`，Doris App 虽能打开，但 **Connections → Add new connection** 中不会出现 **Doris SSO**，App 页面也无法选择数据源。更新变量后重启全部 Grafana 副本。

3. 在 Grafana Generic OAuth 配置公司的标准 OIDC Provider，确保 scope 包含 `openid`，且 Grafana 能取得 ID Token。Datasource 会强制使用 Grafana 转发的身份；Basic 登录、Service Account 和 Alerting 没有交互式用户 token，不能用来查询。

4. 在 Doris FE 开启 TLS，安装并启用 OIDC authentication plugin。多 Grafana 副本必须使用同一私钥，并让 Doris 访问同一个 JWKS URL。

## 创建 Datasource

Grafana 管理员进入 **Connections → Add new connection**，选择 **Doris SSO**，然后填写：

| 页面字段                                   | 填写内容                                                                                      |
| ------------------------------------------ | --------------------------------------------------------------------------------------------- |
| Doris host / MySQL port / Default database | Doris FE 的 MySQL 地址、端口和默认数据库。                                                    |
| OIDC issuer                                | 公司的 OIDC issuer，例如 `https://idp.example.com/realms/company`。该地址必须支持 Discovery。 |
| OIDC audience / Grafana OAuth Client ID    | Grafana 在该 IDP 中的 OAuth Client ID，或 ID Token 中实际的 `aud`。                           |
| OIDC group → Doris role mappings           | 完整 group 路径到 Doris role 的精确映射，例如 `/engineering/readers` → `doris_reader`。       |

保存后，页面会显示只读的 Profile 摘要和自动生成的 audience，例如：

```text
velodb-doris:<datasource-uid>
```

不要把它改成手工 audience。Datasource 的 UID 稳定时，该 audience 也稳定。

## 初始化 Doris

每个 Datasource 第一次保存后，管理员都必须执行它页面中的 **Doris bootstrap SQL**。这是 Doris 信任该 Datasource token 的一次性初始化，不是每个用户都要执行。

生成 SQL 会为该 Datasource 建立独立的：

-   OIDC authentication integration；
-   自动派生的 audience；
-   JIT 用户支持；
-   `doris_groups` claim 的 role mapping。

例如 UID 为 `orders-prod` 时，SQL 会生成：

```text
integration: grafana_doris_sso_orders_prod
role mapping: grafana_doris_sso_orders_prod_roles
audience: velodb-doris:orders-prod
```

这样多个 Datasource 可以连接不同 Doris 集群、数据库或权限模型，而不会互相覆盖。执行生成 SQL 前，按你的业务对象补全 Doris 角色授权，例如：

```sql
CREATE ROLE `doris_reader`;
GRANT SELECT_PRIV ON analytics.* TO ROLE `doris_reader`;

CREATE ROLE `doris_writer`;
GRANT SELECT_PRIV, LOAD_PRIV ON analytics.* TO ROLE `doris_writer`;
```

如果生成 SQL 中的角色已存在，请按当前 Doris 版本的策略使用 `IF NOT EXISTS`、跳过已存在语句，或由 DBA 合并到现有授权脚本；不要删除生产角色。

## 配置 group 到 Doris 权限

假设 IDP 在 ID Token 中发出以下完整 groups：

```text
/engineering/readers
/engineering/writers
```

在 Datasource 填两行：

| OIDC group             | Doris role     |
| ---------------------- | -------------- |
| `/engineering/readers` | `doris_reader` |
| `/engineering/writers` | `doris_writer` |

规则如下：

-   完整路径精确匹配；`/engineering/readers` 不会匹配 `/readers`。
-   Datasource 会将已验证的原始 group 写入 Doris token；例如 `/engineering/readers` 会原样保留。
-   Doris 根据 Bootstrap SQL 中的 `has_group("/engineering/readers")` 规则授予角色；用户命中多个 group 时，Doris 授予所有命中规则的角色并集。
-   没有任何命中时不会获得隐式默认角色，查询是否能执行完全由 Doris 中已生效的授权规则决定。
-   修改页面映射后，必须由 Doris 管理员审核并执行新生成的 Bootstrap SQL；只保存 Datasource 配置不会改变当前 Doris 权限。

## 普通用户如何查询

1. 用公司 OIDC 账号登录 Grafana。
2. 打开 Doris App 的 **Discover**，或在 Dashboard 新建使用该 Datasource 的 SQL 查询。
3. 选择数据库、表和时间范围，运行查询。

在每次查询中，Datasource 会验证用户的 ID Token、转发已验证的原始 group、签发短期 Doris token，并以 JIT Doris 用户身份连接。Doris 用户名默认为上游 token 的 `sub`；用户不需要创建 Doris 密码账号。

如果用户看不到数据源、数据库或表，依次检查：

1. Grafana 是否授予该用户使用 Datasource 的权限；
2. ID Token 是否包含预期的 `groups` claim；
3. 生成并执行的 Doris role mapping 是否精确匹配 token 中的 group；
4. Doris role 是否已被授予目标数据库/表的权限；
5. Doris authentication integration 的 audience 是否与该 Datasource 页面显示的 audience 完全一致。

## 变更与限制

-   新建 Datasource 或重新生成 UID 后，需要执行其新生成的 bootstrap SQL。
-   更换部署级私钥时，需要先更新 Doris 对 JWKS/issuer 的信任，再滚动重启全部 Grafana 副本；当前版本不支持在线双密钥轮换。
-   Datasource 不会自动修改生产 Doris，也不会回退到数据库账号密码。
-   Grafana Alerting 暂不支持，因为告警没有可转发的交互式 OIDC 用户身份。

部署参数和安全约束见 [标准 OIDC → Grafana → Doris SSO Datasource](./keyrock-doris-sso-zh.md)。

用户验收和自动化测试覆盖见 [OIDC 用户验收与测试说明](./oidc-user-test-zh.md)。
