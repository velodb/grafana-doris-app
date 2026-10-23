# VARIANT 功能测试说明

本文说明 Discover 中 Doris `VARIANT` 字段的功能范围，以及本次实现已执行的自测和建议的手工验收步骤。

## 功能点

### JSON 查看

- 主表、行详情和 Surrounding items 中的对象或数组值使用可交互 JSON 树展示。
- JSON 根节点默认展开；内部对象和数组可按节点展开或收起。
- 右上角图标可一次展开全部或收起全部节点。
- 标量、`null`、空值和无法解析的 JSON 字符串安全回退为普通文本。

### Sidebar 字段树

- `VARIANT` 父字段保留为可独立加入表格的字段。
- 父字段默认收起，展开后显示单层叶子列表和叶子总数。
- 嵌套对象会显示为完整路径，例如 `nested.retries`；不会要求逐层展开中间对象。
- 叶子字段根据样本值识别为文本、数字、布尔或数组类型，可独立加入主表和 Surrounding items。
- 搜索叶子字段时会自动展开其父 VARIANT 字段，并仅显示匹配叶子。

### 路径、过滤和排序

- 内部字段保留真实路径数组，因此键名本身带点时仍可正确访问，例如 `k8s.pod.name`。
- Filter 使用真实路径生成 Doris 表达式：

  ```sql
  `resource_attributes`['k8s.pod.name']
  ```

- VARIANT 数字、布尔和文本叶子可排序。Doris 不支持直接按 VARIANT 表达式排序，应用会生成类型转换：

  ```sql
  ORDER BY CAST(`log_attributes`['duration_ms'] AS DOUBLE) DESC
  ```

### Lucene 查询

- 常规嵌套路径继续使用点语法：

  ```text
  resource_attributes.nested.name:checkout
  ```

- 键名本身包含点时使用字面量键语法：

  ```text
  resource_attributes["k8s.pod.name"]:checkout-1
  log_attributes["duration.ms"]:>500
  ```

- 文本查询使用 Doris `MATCH_*` 或 `LIKE` 回退；数字和布尔条件使用安全的类型转换比较。

## 已执行的自动化自测

以下测试在本次变更中已执行并通过，共 9 个测试文件、47 个测试：

| 测试文件 | 覆盖内容 |
| --- | --- |
| `src/components/discover-sidebar/field-item/field-item.variant.test.tsx` | Sidebar 默认收起、扁平叶子、搜索自动展开和匹配过滤 |
| `src/components/discover-content/variant-value-viewer.test.tsx` | JSON 树展开/收起和安全文本回退 |
| `src/utils/__tests__/variant-fields.test.ts` | 叶子推断、嵌套路径、带点键名、数组和取值 |
| `src/utils/__tests__/data.variant.test.ts` | VARIANT 解析、格式化和结果行转换 |
| `src/utils/__tests__/sql-filter.test.ts` | Filter SQL、带点键和转义 |
| `src/utils/query-parser/__tests__/tokenUtils.variant.test.ts` | Lucene 字面量键编码、混合路径和转义字符 |
| `src/utils/query-parser/__tests__/lucene-index-warning.test.ts` | VARIANT 子路径的倒排索引告警判断 |
| `src/services/__tests__/lucene.test.ts` | Lucene 文本、数值、布尔、存在性和带点键条件 |
| `src/services/__tests__/discover.sql.test.ts` | VARIANT 路径排序和 Doris `CAST` 排序 SQL |

执行命令：

```bash
yarn typecheck

yarn jest \
  src/components/discover-sidebar/field-item/field-item.variant.test.tsx \
  src/components/discover-content/variant-value-viewer.test.tsx \
  src/utils/__tests__/variant-fields.test.ts \
  src/utils/__tests__/data.variant.test.ts \
  src/utils/__tests__/sql-filter.test.ts \
  src/utils/query-parser/__tests__/tokenUtils.variant.test.ts \
  src/utils/query-parser/__tests__/lucene-index-warning.test.ts \
  src/services/__tests__/lucene.test.ts \
  src/services/__tests__/discover.sql.test.ts \
  --runInBand

yarn build
```

`yarn build` 当前可能报告既有的大资源体积告警；该告警不影响构建成功。

## 手工验收

使用 [本地 Grafana + Doris 环境](../test-env/README.md) 打开 Discover 后，检查以下项目：

1. 展开 `resource_attributes`，确认显示 `app`、`k8s.namespace.name`、`k8s.pod.label.app` 和 `k8s.pod.name`，且没有逐层对象节点。
2. 将 `k8s.pod.name` 加入表格，确认显示正确的值；再在 Surrounding items 中确认同一列可用。
3. 为该字段添加 Filter，确认查询结果只包含对应 Pod。
4. 按文本叶子和数值叶子排序，确认生成的 SQL 使用 `CAST`，且查询成功。
5. 在 Lucene 模式输入：

   ```text
   resource_attributes["k8s.pod.name"]:checkout-1
   ```

   确认匹配结果中键名被视为单个字面量路径段。
6. 打开任意 VARIANT 单元格的行详情，确认可逐节点展开 JSON，并测试“全部展开 / 全部收起”图标。
