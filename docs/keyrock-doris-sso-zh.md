# 标准 OIDC → Grafana → Doris SSO Datasource

`velodb-doris-datasource` 是随 Doris App 一起发布的 Go backend datasource。Grafana 转发用户的标准 OIDC ID Token，Datasource 通过 Discovery/JWKS 校验后签发仅面向 Doris 的 5 分钟 RS256 token。

## 部署级 Doris SSO Profile

每个 Grafana 部署配置一份 Doris SSO Profile；所有 Datasource 共用 Profile 私钥、issuer 和 JWKS URL。私钥只从部署 Secret 文件读取，绝不出现在 Datasource 表单、Grafana API 响应或浏览器中。

| 环境变量                               | 说明                                                |
| -------------------------------------- | --------------------------------------------------- |
| `VELODB_DORIS_SSO_SIGNING_KEY_FILE`    | RSA PEM 私钥文件路径，必填。                        |
| `VELODB_DORIS_SSO_ISSUER`              | Datasource 签发 Doris token 的稳定 issuer，必填。   |
| `VELODB_DORIS_SSO_JWKS_PUBLIC_URL`     | Doris FE 可访问的 JWKS URL，必填。                  |
| `VELODB_DORIS_SSO_JWKS_LISTEN_ADDR`    | 插件本地 JWKS 监听地址，默认 `:8999`。              |
| `VELODB_DORIS_SSO_SIGNING_KEY_ID`      | JWKS key ID，默认 `velodb-doris-sso`。              |
| `VELODB_DORIS_SSO_ALLOW_INSECURE_HTTP` | 仅本地测试时设为 `true`；生产环境保持默认 `false`。 |

Grafana 12.4 及更高版本默认不会把宿主环境变量传给插件子进程。因此还必须在 Grafana 配置中加入：

```ini
[plugins]
forward_host_env_vars = velodb-doris-datasource
```

Docker 环境等价于 `GF_PLUGINS_FORWARD_HOST_ENV_VARS=velodb-doris-datasource`。这只会把部署环境交给本 datasource 插件；私钥仍只以文件形式挂载，绝不保存到 Datasource 配置中。

Grafana 高可用部署中的每个副本必须挂载同一把私钥，并由同一个对外 JWKS URL 提供公钥。

## 配置顺序

1. 部署管理员通过 Secret 挂载 RSA 私钥，并配置上方的 Doris SSO Profile 环境变量；将 JWKS listener 暴露到 Doris 可访问的 HTTPS URL。
2. 在 Grafana Generic OAuth 中配置 IDP，并保留 ID Token；Datasource 会强制启用 **Forward OAuth identity**。
3. 新建 Datasource 时，仅配置 Doris 连接、标准 **OIDC Discovery** issuer/audience 和 group → Doris role 映射；映射只用于生成 Doris SQL。
4. 保存 Datasource 后，插件按其 UID 自动生成 Doris token audience：`velodb-doris:<datasource-uid>`；配置页显示只读 Profile 摘要与对应的 **Doris bootstrap SQL**。
5. 在 Doris 开启 FE TLS，安装 OIDC authentication plugin，然后由 Doris 管理员执行生成 SQL，并按业务对象补充角色权限。

升级到部署级 Profile 前，先配置 Profile Secret 并在 Doris 更新 authentication integration 的 issuer、JWKS URL 和 audience；旧 Datasource 内的签名私钥和 bootstrap 字段不会再被读取。

## 安全约束

-   Datasource 只接受标准 OIDC RS256 ID Token，检查 `iss`、`aud`、签名与时间声明；没有 ID Token 不会退回账号密码认证。
-   每次查询签发一个新 token；token 最长 5 分钟，连接查询后关闭，不跨用户复用。
-   MySQL OIDC 协议连接强制 TLS；token 超过 10 KiB 或 Doris 要求不支持的认证方式会失败关闭。
-   Datasource 会将已验证 ID Token 的标准 `groups` claim 原样写入签发给 Doris 的 `doris_groups` claim；Doris 通过管理员执行的 Bootstrap SQL 将完整 group 路径映射到角色。
-   IDP 需要将用户组作为 `groups` claim 写入 ID Token，并保留完整路径，例如 `/team/readers`。没有匹配的 Doris role mapping 时，用户不会获得隐式默认角色。
-   第一版不支持在线双密钥轮换。更换 Profile 私钥时，先更新 Doris 信任的 JWKS/认证集成，再滚动重启 Grafana 副本。

## 构建

```bash
mage BuildAll
yarn build
```

`BuildAll` 生成 Grafana Docker 常用的 `linux_amd64`、`linux_arm64` binary 和当前开发机 binary。构建会对固定版本 `github.com/go-sql-driver/mysql` 应用 `internal/mysqloidc/authentication_openid_connect_client.patch`；补丁实现 MySQL OIDC client 的 TLS/JWT 握手。

Grafana Alerting 没有交互式 OIDC 用户身份，因此第一版不支持 datasource alerting。

用户验收步骤和自动化测试范围见 [OIDC 用户验收与测试说明](./oidc-user-test-zh.md)。
