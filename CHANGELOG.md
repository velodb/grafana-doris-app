# Changelog

## 1.1.20 (2026-10-20)

### 🐛 Bug Fixes

* retain password input when SSO is disabled so new passwords and replacements after Reset can be edited and saved correctly

## 1.1.19 (2026-10-19)

### 🐛 Bug Fixes

* cascade datasource and database changes through database, table, and time-field selections in Discover, Traces, and plugin settings; discard stale metadata responses when switching selections
* use the datasource default database as a fallback while preserving explicit page and plugin preferences, and load current datasource settings instead of persisted configuration copies
* hide the datasource Default control and Default database input while retaining saved configuration values

## 1.1.18 (2026-10-15)

### 🐛 Bug Fixes

* preserve datasource configuration and SSO setup failures in per-query responses so Grafana exposes the underlying error instead of a generic plugin failure
* display backend error messages directly in Discover, with actionable SSO guidance and log troubleshooting for generic plugin errors
* consistently extract query error messages across HTTP failures and embedded Grafana query results

## 1.1.17 (2026-10-15)

### 🐛 Bug Fixes

* allow local administrators to save SSO datasource configuration without an OIDC ID Token; report SSO verification as pending after configuration checks pass, with Doris connectivity and TLS still unverified
* let OIDC users verify SSO by querying in Explore or Doris App Discover with query access only; keep rejecting queries with missing or invalid tokens
* clarify the administrator setup and ordinary-user verification workflow in the datasource editor and documentation

## 1.1.16 (2026-10-14)

### ✨ Features

* add a Verify Doris TLS certificate switch to select encrypted connections without CA or host/IP verification, matching MySQL ssl-mode=REQUIRED

### 🐛 Bug Fixes

* automatically synchronize OAuth identity forwarding with SSO and repair missing forwarding settings when existing datasource configurations are opened and saved
* document the SSO forwarding configuration and Doris TLS certificate verification controls

## 1.1.15 (2026-10-14)

### 🐛 Bug Fixes

* require SSO Save & test to verify the forwarded user identity and execute SELECT 1 over the Doris TLS connection; report missing ID Tokens instead of claiming an unverified connection succeeded

## 1.1.14 (2026-10-14)

### ✨ Features

* add datasource IDP TLS certificate verification controls, enabled by default, and encrypted custom PEM CA bundle configuration
* apply datasource-specific TLS settings to OIDC Discovery and JWKS requests, with isolated caches refreshed on configuration changes
* validate IDP JWKS during Save & test and document TLS provisioning


## [1.1.5](https://github.com/jeffreys-cat/grafana-doris-app/compare/v1.1.4...v1.1.5) (2026-08-26)

### 🐛 Bug Fixes

* make Lucene `VARIANT` queries compatible with Apache Doris 4.0 by using `CAST` and `TRY_CAST` instead of unsupported ClickHouse conversion functions
* support safe text, numeric, boolean, and existence filtering on `VARIANT` paths

## [1.1.4](https://github.com/jeffreys-cat/grafana-doris-app/compare/v1.1.3...v1.1.4) (2026-07-23)

### ✨ Features

* add configurable Kubernetes Application filtering to Discover
* support exact resource attribute keys, including dotted Kubernetes label keys

### 🐛 Bug Fixes

* hide the Application selector and skip option queries until an attribute key is configured
* safely escape Application filter identifiers, keys, and values

## [1.0.1](https://github.com/jeffreys-cat/grafana-doris-app/compare/v1.0.1-alpha.3...v1.0.1) (2026-02-06)

### ✨ Features

* storage the config ([122cff9](https://github.com/jeffreys-cat/grafana-doris-app/commit/122cff91743eb6b8c3e031864298fa4492bef4ea))
* storage the header conds ([8d8773b](https://github.com/jeffreys-cat/grafana-doris-app/commit/8d8773bf1e43fdbcb9f1c90259583743421deeef))
* update number type icon ([c9d7c54](https://github.com/jeffreys-cat/grafana-doris-app/commit/c9d7c546e2bcfc7a888afe015ad99e15fbbfaacf))

## [1.0.1-alpha.3](https://github.com/jeffreys-cat/grafana-doris-app/compare/v1.0.1-alpha.2...v1.0.1-alpha.3) (2026-02-05)

## [1.0.1-alpha.2](https://github.com/jeffreys-cat/grafana-doris-app/compare/v1.0.1-alpha.1...v1.0.1-alpha.2) (2026-02-04)

### 🎫 Chores

* update author name ([b6cd8d1](https://github.com/jeffreys-cat/grafana-doris-app/commit/b6cd8d1e79576bcbc919b2285eae3f9a5b4403aa))

## [1.0.1-alpha.1](https://github.com/jeffreys-cat/grafana-doris-app/compare/v1.0.0-alpha.1...v1.0.1-alpha.1) (2026-02-02)

## 1.0.0-alpha.1 (2026-02-02)

### ✨ Features

* add release it ([4374fdc](https://github.com/jeffreys-cat/grafana-doris-app/commit/4374fdc17fe6922993f41c0c3dacb0478fb87e9c))
* add the trace detail on discover logs ([c88d718](https://github.com/jeffreys-cat/grafana-doris-app/commit/c88d7188a82576dd31e03b0633a91075d4031ea8))
* init the app ([f88a83e](https://github.com/jeffreys-cat/grafana-doris-app/commit/f88a83ea87baf6bc22fb898b24aaaf86702897fa))

### 🐛 Bug Fixes

* add .config ([c1300b7](https://github.com/jeffreys-cat/grafana-doris-app/commit/c1300b7706319644f1f34e4c480e953f96d53569))
* add more basic config ([5245b59](https://github.com/jeffreys-cat/grafana-doris-app/commit/5245b597307447948ffe0b721f6016d73224f96b))
* fix all name translate error ([aa95763](https://github.com/jeffreys-cat/grafana-doris-app/commit/aa957636afb82158bb32381132ad70b19bbd56cc))

## 1.0.0 (Unreleased)

Initial release.
