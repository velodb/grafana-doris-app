# Doris SSO Datasource 使用指南

本指南说明如何让用户通过公司的标准 OIDC 登录 Grafana，并以各自的身份查询 Doris。用户不需要 Doris 密码，也不需要在 Datasource 中填写私钥或 JWKS 地址。

从全新服务器搭建单机验证环境，请按 [Keycloak 单机从零部署指南](./keycloak-single-host-deployment-zh.md) 操作，其中提供完整 Compose、配套安装包说明、参数替换表和实际控制台截图。该教程明确区分已经完成的容器验收与尚未实测的 Ubuntu 24.04 主机安装步骤。

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

这一步由部署管理员完成一次；同一个 Grafana 部署的所有 Doris Datasource 共用它。下面的六个变量配置在 **Grafana 服务的运行环境** 中，不能填到 Datasource 表单或 Doris FE 配置里。修改后需要重启 Grafana，让插件重新读取配置。

### 这些配置解决什么问题

用户登录 Grafana 后，插件会给 Doris 签发一张短期“身份证明”（JWT）。插件用私钥签名，Doris 从 JWKS 地址取得对应公钥，确认这张证明确实由受信任的插件签发。JWKS 是公钥集合的 JSON 格式，不包含私钥。

因此，部署时需要准备三件事：一把供插件签名的 RSA 私钥、一个稳定的签发者标识，以及一个 Doris FE 能访问的公钥地址。8999 是插件提供公钥的内部端口；Grafana 页面通常使用的 3000 端口负责另一项服务。

### 六个环境变量逐项说明

| 变量 | 用途 | 如何填写／是否必填 |
| ---- | ---- | ------------------ |
| `VELODB_DORIS_SSO_SIGNING_KEY_FILE` | 告诉插件到哪里读取 RSA 签名私钥。 | **必填**。填 Grafana 进程／容器内部实际可读的 PEM 文件绝对路径，例如 `/run/secrets/velodb-doris-sso.pem`。文件必须提前生成并挂载；变量本身不会创建文件。 |
| `VELODB_DORIS_SSO_ISSUER` | 写入插件签发的 Doris JWT 的 `iss` 字段，让 Doris 识别签发者。 | **必填**。选择稳定的 HTTPS URL，例如 `https://grafana.example.com/doris-sso`，并与生成的 Doris bootstrap SQL 保持一致。该 URL 作为身份标识使用，插件不会为它提供首页或 OIDC Discovery 服务。 |
| `VELODB_DORIS_SSO_JWKS_PUBLIC_URL` | 告诉 Doris 到哪里下载插件的公钥以验证 JWT 签名。 | **必填**。填所有相关 Doris FE 都能访问的完整 HTTPS 地址，例如 `https://grafana.example.com/doris-sso/.well-known/jwks.json`。这里的“Public”表示对 Doris 可访问，不要求向整个互联网开放。 |
| `VELODB_DORIS_SSO_JWKS_LISTEN_ADDR` | 插件进程提供 JWKS HTTP 服务时绑定的内部地址和端口。 | 可选，默认 `:8999`，表示监听所有可用网络接口的 8999 端口。通常保留默认值；若修改端口，代理目标也要一起改。代理与 Grafana 同机且无需跨容器访问时，可绑定 `127.0.0.1:8999`。 |
| `VELODB_DORIS_SSO_SIGNING_KEY_ID` | 给这把密钥取一个标识，写入 JWT 头部和 JWKS 的 `kid` 字段，帮助 Doris 选择公钥。 | 可选，默认 `velodb-doris-sso`。通常原样保留。它是密钥名称，不是密码、私钥内容或文件名；多副本必须使用一致的值。 |
| `GF_PLUGINS_FORWARD_HOST_ENV_VARS` | 让 Grafana 把运行环境变量传给指定插件的后端进程，否则插件可能读不到上面五项。 | Grafana 12.4 及以上版本需配置。填写插件 ID **`velodb-doris-datasource`**，不是变量名称列表，也不是 `velodb-doris-app`。如果已有其他插件 ID，在现有逗号分隔列表中追加此 ID。 |

`GF_PLUGINS_FORWARD_HOST_ENV_VARS` 会向指定插件转发全部宿主环境变量，应仅指定信任的插件。该行为见 [Grafana 官方说明](https://grafana.com/whats-new/2026-02-24-plugin-processes-no-longer-receive-all-host-environment-variables-by-default/)。

**两个 issuer 不要混填：** 环境变量中的 `VELODB_DORIS_SSO_ISSUER` 标识“插件 → Doris”的令牌签发者；后文 Datasource 表单里的 **OIDC issuer** 标识“公司 IDP → Grafana 用户”的令牌签发者，例如 Keycloak 的 realm URL。两者各自对应不同的签名密钥和验证环节。

### 按顺序配置

1. 生成 RSA 私钥，并以 Secret 文件挂载到每个 Grafana 副本。例如：

    ```bash
    mkdir -p ./secrets
    openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:3072 -out ./secrets/velodb-doris-sso.pem
    chmod 600 ./secrets/velodb-doris-sso.pem
    ```

    在部署目录生成后，将该文件只读挂载到 Grafana 容器的 `/run/secrets/velodb-doris-sso.pem`。宿主机路径和容器路径可以不同，环境变量必须填写**容器路径**。如果使用 `600` 权限，文件所有者必须与容器内运行 Grafana 的 UID 对应；否则插件仍然无法读取。Kubernetes 可使用 Secret volume，并根据 Pod 的 `runAsUser`／`fsGroup` 设置可读权限。

    这把私钥用于 JWT 签名，与 Grafana HTTPS 证书、Doris TLS 证书、公司 IDP 的签名密钥各自独立。不要把私钥提交到 Git 或粘贴到文档。已有私钥应继续使用，扩容时分发同一份文件，不要为每个副本重新生成。

2. 为 Grafana 配置下列环境变量。`JWKS_PUBLIC_URL` 必须是 Doris FE 可以访问的 HTTPS 地址；它反向代理到插件的 listener。

    ```bash
    VELODB_DORIS_SSO_SIGNING_KEY_FILE=/run/secrets/velodb-doris-sso.pem
    VELODB_DORIS_SSO_ISSUER=https://grafana.example.com/doris-sso
    VELODB_DORIS_SSO_JWKS_PUBLIC_URL=https://grafana.example.com/doris-sso/.well-known/jwks.json
    VELODB_DORIS_SSO_JWKS_LISTEN_ADDR=:8999
    VELODB_DORIS_SSO_SIGNING_KEY_ID=velodb-doris-sso
    GF_PLUGINS_FORWARD_HOST_ENV_VARS=velodb-doris-datasource
    ```

    `grafana.example.com` 是占位域名，需要替换成你们实际使用的域名；`/doris-sso` 是此示例约定的代理路径，可以更换，但 JWKS URL 与代理规则必须对应。仅设置这两个 URL 不会自动创建 DNS、HTTPS 证书或代理路由。

    `VELODB_DORIS_SSO_ALLOW_INSECURE_HTTP=true` 仅限本地开发，生产环境不要设置。

    如果通过 ZIP 或本地目录安装的是未签名版本，还必须允许 App 和其内置 Datasource 两个插件 ID：

    ```bash
    GF_PLUGINS_ALLOW_LOADING_UNSIGNED_PLUGINS=velodb-doris-app,velodb-doris-datasource
    ```

    Grafana 会分别校验这两个 ID。若只允许 `velodb-doris-app`，Doris App 虽能打开，但 **Connections → Add new connection** 中不会出现 **Doris SSO**，App 页面也无法选择数据源。更新变量后重启全部 Grafana 副本。

3. 在 Grafana Generic OAuth 配置公司的标准 OIDC Provider，确保 scope 包含 `openid`，且 Grafana 能取得 ID Token。Datasource 会强制使用 Grafana 转发的身份；Basic 登录、Service Account 和 Alerting 没有交互式用户 token，不能用来查询。

4. 在 Doris FE 开启 TLS，安装并启用 OIDC authentication plugin。多 Grafana 副本必须使用同一私钥，并让 Doris 访问同一个 JWKS URL。

### Docker Compose：变量到底放在哪里

将以下内容合并到现有 `docker-compose.yaml` 的 **Grafana service** 中；这里假设服务名为 `grafana`，已安装 Doris App，且私钥已按前文生成并设置为 Grafana 用户可读。保留服务原有的 `image`、插件挂载、数据卷和 OAuth 配置：

```yaml
services:
    grafana:
        environment:
            VELODB_DORIS_SSO_SIGNING_KEY_FILE: /run/secrets/velodb-doris-sso.pem
            VELODB_DORIS_SSO_ISSUER: https://grafana.example.com/doris-sso
            VELODB_DORIS_SSO_JWKS_PUBLIC_URL: https://grafana.example.com/doris-sso/.well-known/jwks.json
            VELODB_DORIS_SSO_JWKS_LISTEN_ADDR: ":8999"
            VELODB_DORIS_SSO_SIGNING_KEY_ID: velodb-doris-sso
            GF_PLUGINS_FORWARD_HOST_ENV_VARS: velodb-doris-datasource
        volumes:
            - ./secrets/velodb-doris-sso.pem:/run/secrets/velodb-doris-sso.pem:ro
```

修改后在 Compose 文件所在目录执行 `docker compose up -d grafana`，让服务以新的配置重建。仅把变量写进 Compose 的 `.env` 文件并不会自动注入容器，仍须通过 `environment` 引用，或在 Grafana service 中配置 `env_file`。不要只在终端里执行这些赋值后就认为正在运行的 Grafana 已经更新。

Kubernetes 部署将前五项和 `GF_PLUGINS_FORWARD_HOST_ENV_VARS` 放在 Grafana container 的 `env` 中，并用 Secret volume 挂载私钥；修改后滚动更新 Pod。systemd 部署则通过 Grafana 服务的 `Environment`／`EnvironmentFile` 设置变量并重启服务。非容器部署的 `SIGNING_KEY_FILE` 应填写该服务所在主机上的真实路径。

也可以在已有 `grafana.ini` 中设置 Grafana 自身的转发选项，与 `GF_PLUGINS_FORWARD_HOST_ENV_VARS` 二选一：

```ini
[plugins]
forward_host_env_vars = velodb-doris-datasource
```

其余 `VELODB_DORIS_SSO_*` 项仍由插件从进程环境读取，不能直接写成 `grafana.ini` 中的同名配置项。

### 配置公钥地址的反向代理

以 HTTPS 入口域名 `grafana.example.com` 为例，Doris 访问的路径与插件内部路径之间的关系是：

```text
Doris FE
  → https://grafana.example.com/doris-sso/.well-known/jwks.json
  → Nginx／Ingress 终止 HTTPS，并将路径改写为 /.well-known/jwks.json
  → http://grafana:8999/.well-known/jwks.json
  → 返回 RSA 公钥 JSON
```

插件只提供内部 HTTP listener，HTTPS 由入口代理负责。示例 Nginx 配置如下，将 `location` 合并到已配置证书的 `server` 块中。这里的 `grafana` 必须是 Nginx 所在网络可解析、可连接的 Grafana 服务名：

```nginx
location = /doris-sso/.well-known/jwks.json {
    proxy_pass http://grafana:8999/.well-known/jwks.json;
}
```

此规则要直接返回公钥 JSON，不能跳转到 Grafana 登录页，也不能要求浏览器 Cookie。插件并未在 8999 上提供 `/doris-sso/.well-known/jwks.json`，若把整个外部路径原样转发会返回 404。也不能将该地址转发到 Grafana 页面服务的 3000 端口。

Nginx 与 Grafana 在同一个 Compose 网络时，无需为 8999 配置宿主机 `ports`；通过容器网络访问即可。如果 Nginx 在宿主机，可按部署需要将 8999 发布到宿主机回环地址，并将代理目标改为 `http://127.0.0.1:8999/.well-known/jwks.json`。Kubernetes 的 Service 需转发到 Pod 的 8999 端口，Ingress 同样需要把外部路径改写为插件的内部路径。

### 配完如何确认

1. 确认 Grafana 运行用户能读取配置路径下的私钥，插件已成功启动，8999 未被其他进程占用。
2. **从每个相关 Doris FE 所在环境**访问对外 JWKS URL，验证 DNS、网络和 HTTPS 证书均可用：

    ```bash
    curl --fail --show-error https://grafana.example.com/doris-sso/.well-known/jwks.json
    ```

    正常应返回 HTTP 200 和类似下面的 JSON。`n`、`e` 是公钥参数，不需要手工填写；这里用省略号代替实际值：

    ```json
    {"keys":[{"kty":"RSA","use":"sig","alg":"RS256","kid":"velodb-doris-sso","n":"...","e":"AQAB"}]}
    ```

3. 保存 Datasource 后，确认页面的只读 Profile 摘要显示预期的 issuer、JWKS URL 和 key ID，再由 Doris 管理员执行页面生成的 bootstrap SQL。issuer 必须与 JWT 的 `iss` 一致，包括路径和尾部斜杠。
4. 管理员可以用本地 admin 保存 Datasource 配置；没有 OIDC ID Token 时会提示“SSO verification pending”（待验证）。普通用户用公司 OIDC 账号登录 Grafana 后，在 Explore 或 Doris App Discover 执行查询，验证用户身份及实际 Doris 连接，无需数据源管理权限。JWKS URL 能访问只说明公钥服务正常，不代表用户登录、Doris integration 或表权限已配置完成。

| 现象 | 优先检查 |
| ---- | -------- |
| `Doris SSO Profile is not configured` | 三个必填变量是否注入 Grafana 服务，以及 Grafana 是否通过 `forward_host_env_vars` 将它们传给 datasource 后端。 |
| `signing key could not be loaded` | 文件挂载路径是否与变量一致，文件所有者／权限是否允许 Grafana 用户读取。 |
| `signing key is invalid` | 文件是否为 RSA PEM 私钥，而非公钥或 TLS 证书。 |
| `JWKS listener could not start` | 8999 是否被占用，绑定地址是否存在；修改监听端口后同步修改代理目标。 |
| 外部 JWKS 返回 404 | 外部路径是否改写为 `/.well-known/jwks.json`，是否误代理到 3000 端口。 |
| 外部 JWKS 返回 502 或连接超时 | 代理是否能连接插件的 8999，插件是否正常启动，容器网络／Service 端口是否正确。 |
| JWKS 返回登录页面／跳转 | JWKS 路由是否被登录鉴权拦截，代理是否命中了 Grafana 页面服务。 |
| 浏览器可以访问，Doris FE 不能访问 | 从 FE 检查 DNS、路由、防火墙与 CA 信任；浏览器的访问结果不能替代 FE 的验证。 |

## 创建 Datasource

Grafana 管理员进入 **Connections → Add new connection**，选择 **Doris SSO**，然后填写：

开启 **Enable SSO** 会自动开启 Grafana 的 **Forward OAuth Identity**（数据源配置中的 `jsonData.oauthPassThru: true`），把当前登录用户的 OAuth 身份和可用的 OIDC ID Token 转发给插件。关闭 SSO 时也会关闭身份转发，改用配置的 Doris 用户名和密码。

已有 SSO 数据源升级插件后，打开其配置页并点击 **Save & test**，即可补齐身份转发配置。仅升级插件不会修改已保存的数据源配置。

如果通过 provisioning 或 Grafana 数据源 API 创建或修改数据源，必须同时设置 `enableSso: true` 和 `oauthPassThru: true`；它们属于每个数据源的 `jsonData`，不属于 `grafana.ini` 的 `[auth.generic_oauth]`。登录端仍须请求 `openid` scope，并获得 ID Token。出现 `OIDC ID token is required; enable Forward OAuth Identity for this datasource` 时，先检查 `oauthPassThru`，再检查登录端是否取得 ID Token。

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

### Doris TLS 证书配置

数据源配置页的 **Connection** 区域提供 **Verify Doris TLS certificate** 开关，默认开启。要采用与 MySQL client 的 `--ssl-mode=REQUIRED` 相同的证书校验策略：

1. 开启 **Enable SSO**，页面会自动启用 TLS 和 OAuth 身份转发。
2. 关闭 **Verify Doris TLS certificate**。
3. 管理员点击 **Save & test** 保存配置；没有 OIDC ID Token 时显示待验证。普通 OIDC 用户登录后，在 Explore 或 Doris App Discover 执行查询完成验证。

关闭证书验证会设置 `jsonData.tlsSkipVerify: true`，连接仍使用 TLS 加密，但不验证 Doris 证书的 CA 和 IP／域名。无需手工编辑 JSON，也无需修改 SSO Token 签名私钥。该开关只影响 Doris MySQL 连接，与下方的 IDP TLS 开关独立；在用户名密码模式下启用 TLS 时也可使用。

### IDP TLS 证书配置

SSO 配置区提供以下设置，作用于 Datasource 后端请求 IDP 的 OIDC Discovery 和 JWKS（包括 backchannel、Keyrock 与兼容模式）：

| 页面字段                              | 配置字段                      | 默认行为                                                                 |
| ------------------------------------- | ----------------------------- | ------------------------------------------------------------------------ |
| Skip IDP TLS certificate verification | `jsonData.idpTlsSkipVerify`   | 默认 `false`，验证证书链及主机名。开启后跳过这两项验证，仅建议用于测试。 |
| IDP CA certificate                    | `secureJsonData.idpTlsCACert` | 可选的 PEM CA bundle，可包含多个证书；追加到系统信任库。                 |

内部 CA 或自签证书环境应填写可信 CA，保持跳过验证开关关闭。保存后的 CA 使用 Grafana 加密存储，页面只显示已配置状态；点击 **Reset IDP CA certificate** 后可清除或输入替换证书，再保存。即使开启跳过验证，无效 PEM 仍会报错。CA 保持可编辑，并在恢复验证后用于校验。

修改 TLS 设置或 CA 后，后续请求使用新的连接与缓存。关闭 SSO 保留这些设置，但基本认证模式不使用它们。IDP TLS 与 Doris MySQL TLS 是独立配置；`allowInsecureIdp` 仅控制本地 HTTP 测试，跳过证书验证不会允许 HTTP 或 HTTPS 自动降级。

Grafana 登录端的 `[auth.generic_oauth]` TLS 设置也需独立配置：Datasource 的这些字段只影响插件后端，不会修改 Grafana 登录请求。语义对应 Generic OAuth 的 `tls_skip_verify_insecure` 和 `tls_client_ca`；这里通过页面提供 PEM 内容，无需挂载 CA 文件。

Provisioning 示例（替换连接信息和完整 CA PEM）：

```yaml
apiVersion: 1
datasources:
    - name: Doris SSO
      type: velodb-doris-datasource
      uid: doris-sso
      access: proxy
      jsonData:
          host: doris.example.com
          port: 9030
          enableSso: true
          oauthPassThru: true
          providerMode: oidcDiscovery
          oidcIssuer: https://idp.example.com/realms/company
          oidcAudience: grafana-client
          idpTlsSkipVerify: false
      secureJsonData:
          idpTlsCACert: |
              -----BEGIN CERTIFICATE-----
              <完整的 CA 证书 base64 内容>
              -----END CERTIFICATE-----
```

**Save & test** 会检查部署级 SSO Profile、Discovery 和 IDP JWKS 是否可获取、可解析。管理员可以使用本地 admin 保存配置，无需先给 OIDC 用户授予数据源管理权限。当前会话没有 ID Token 时，基础检查通过后返回非错误的“SSO verification pending”（待验证）提示，并明确 Doris 连接及证书尚未验证；这不代表 SSO 连接已经成功。有 ID Token 时，继续校验身份、交换 Doris 令牌，通过 TLS 连接 Doris 执行 `SELECT 1`。配置、证书、主机名、身份认证或连接错误仍返回对应失败信息。Doris 使用自签证书时，需要配置可信 CA，或在测试环境开启 Doris 的跳过证书验证选项；IDP 的跳过验证选项不会影响 Doris。

普通用户只需拥有该数据源的查询访问权限，使用 OIDC 登录 Grafana 后，在 Explore 或 Doris App Discover 选择已配置的数据源并执行 `SELECT 1`，即可验证 SSO 链路，无需打开配置页或执行 **Save & test**。随后查询业务表验证 Doris 授权。查询接口始终要求有效的 ID Token；缺少或无效的 token 仍会拒绝查询，不会回退到账号密码认证。待验证是当前检查请求的结果，不会限制后续用户查询，也不是全局持久化的验证状态。

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
