# OIDC 用户验收与测试说明

本文用于验证 Doris SSO Datasource 的标准 OIDC 登录、身份校验和 Doris 授权链路。它面向部署管理员、Datasource 管理员和测试人员；生产环境测试请使用专用测试用户、测试角色和测试对象。

## 功能范围

每次查询会经过以下边界：

```text
OIDC ID Token（sub、groups）
        ↓
Grafana 转发身份
        ↓
Datasource 校验 issuer、audience、RS256 签名和时间声明
        ↓
Datasource 签发 5 分钟 Doris token，原样写入已验证的 groups
        ↓
Doris 根据 Bootstrap SQL 中的 group → role 规则授予权限
```

-   Datasource 只负责认证和转发已验证的身份；不在运行时把 group 转换为 Doris role，也没有隐式默认角色。
-   `OIDC group to Doris role mappings` 仅用于生成 **Doris bootstrap SQL**。Doris 管理员审核并执行 SQL 后，角色规则才生效。
-   每个 Datasource 使用其 UID 派生的 audience：`velodb-doris:<datasource-uid>`。
-   未携带 ID Token、签名/issuer/audience/有效期不正确的 Token 都会在连接 Doris 前被拒绝。

## 测试前准备

1. 按 [Doris SSO Datasource 使用指南](./doris-sso-user-guide-zh.md) 完成部署级 SSO Profile、Grafana Generic OAuth、Doris FE TLS 与 OIDC plugin 配置。
2. 在 Datasource 中填写 OIDC issuer 和 audience，并配置需要的 group → Doris role 映射。
3. 保存 Datasource 后，复制页面生成的 **Doris bootstrap SQL**，由 Doris 管理员执行；同时为角色授予测试库、表所需的最小权限。
4. 准备至少两个 OIDC 测试用户：一个属于已映射 group，另一个不属于任何映射 group。若要验证并集，再准备属于多个 group 的用户。

## 用户验收步骤

### 1. 验证已映射用户可查询

1. 使用属于例如 `/engineering/readers` 的 OIDC 用户登录 Grafana。
2. 打开 **Connections → Data sources → Doris SSO**，执行 **Save & test**。
3. 在 Explore 或 Doris App Discover 执行一条只读 SQL，例如：

    ```sql
    SELECT CURRENT_USER(), COUNT(*) FROM analytics.logs;
    ```

4. 预期：查询成功；Doris 中的 JIT 用户名对应上游 token 的 `sub`；该用户仅具备 `/engineering/readers` 在 Bootstrap SQL 中映射到的角色权限。

### 2. 验证 group → role 规则由 Doris 控制

1. 在 Datasource 配置 `/engineering/readers` → `doris_reader`。
2. 确认生成 SQL 中包含下列语义（标识符名称会随 Datasource UID 改变）：

    ```sql
    RULE (USING CEL 'has_group("/engineering/readers")' GRANT ROLE `doris_reader`)
    ```

3. 修改映射后，重新执行新的 Bootstrap SQL，再用该用户查询。
4. 预期：只有 Doris 中已执行的 role mapping 决定权限。仅保存 Grafana Datasource 配置、未执行 SQL，不应改变已生效的 Doris 权限。

### 3. 验证未映射用户被拒绝

1. 使用不属于任何已配置 group 的 OIDC 用户登录。
2. 执行需要 `doris_reader` 的查询。
3. 预期：Doris 不授予该角色，查询因权限不足失败；不存在“默认 `doris_reader`”兜底。

### 4. 验证多 group 用户的权限并集

1. 为同一用户配置 `/engineering/readers` 与 `/engineering/writers` 两个 group。
2. 在 Doris Bootstrap SQL 中分别将两个 group 映射到对应角色，并授予不同的测试权限。
3. 登录后执行两个角色各自允许的测试操作。
4. 预期：Doris 根据 token 中的两个原始 group 计算规则，授予两个映射角色的权限并集。

### 5. 验证拒绝路径

在隔离环境中验证以下情况均不能访问 Doris：

| 场景                                                       | 预期结果                                     |
| ---------------------------------------------------------- | -------------------------------------------- |
| 未启用 Grafana 的 Forward OAuth Identity 或未获得 ID Token | 请求在 Datasource 拒绝，不回退至数据库密码。 |
| ID Token 的 `aud` 与 Datasource audience 不一致            | Token 校验失败。                             |
| ID Token 的 `iss` 与 Discovery issuer 不一致               | Token 校验失败。                             |
| ID Token 过期、尚未生效或签名不是 RS256                    | Token 校验失败。                             |
| ID Token 缺少 `sub`，或 `groups` 不是字符串/字符串数组     | Token 校验失败。                             |

## 本地 Keycloak 验收环境

仓库提供隔离的 Keycloak 环境，详细启动方式见 [test-env/README.md](../test-env/README.md)。该 realm 包含：

| 用户                    | 原始 `groups` claim                | 用途             |
| ----------------------- | ---------------------------------- | ---------------- |
| `doris.keycloak.tester` | `/doris-readers`                   | 验证只读角色。   |
| `doris.keycloak.writer` | `/doris-writers`                   | 验证写入角色。   |
| `doris.keycloak.multi`  | `/doris-readers`、`/doris-writers` | 验证多角色并集。 |

本地 role mapping 应直接匹配原始 group：`/doris-readers` → `doris_reader`，`/doris-writers` → `doris_writer`。本地凭据仅用于测试，禁止复用到其他环境。

## 已完成的自动化自测

| 测试位置                              | 已覆盖的行为                                                                                                                             |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `pkg/plugin/token_test.go`            | RS256 token 校验与 Doris token 签发、issuer/audience 校验、过期/未生效 token、缺少 `sub`、非法 `groups`、无 token、JWKS `kid` 轮换刷新。 |
| `pkg/plugin/provider_test.go`         | OIDC Discovery 缓存、issuer 精确匹配、HTTP 限制、畸形 Discovery 文档、缺失 `jwks_uri`、backchannel JWKS 地址重写。                       |
| `pkg/plugin/datasource_test.go`       | Profile 不泄露私钥、每个 Datasource 的 audience 隔离、缺少 ID Token 时在访问 Doris 前拒绝。                                              |
| `src/datasource/ConfigEditor.test.ts` | Bootstrap SQL 使用原始 OIDC group 生成 Doris role mapping，且不生成隐式默认角色。                                                        |

本次变更已运行：

```bash
go test ./...
yarn typecheck
yarn jest --passWithNoTests --runInBand
```

三项命令均已通过。若修改认证、Token、Bootstrap SQL 或 Datasource 配置，请重新执行以上命令，并重新进行“用户验收步骤”中的最小回归。
