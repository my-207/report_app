---
name: fix-data-filling-v2
overview: 修复列表表/混合表/KV表数据填充失败问题：(1) dataTableToXml 数据格式回归修复——rows 类型是 Record<string,string>[] 应该用 r[h] 而非 r[idx]；(2) fillKeyValueRow 合并单元格配对错位——第一列 vMerge continue 行导致标签-值物理索引与逻辑列不对齐。
todos:
  - id: fix-datatable-toxml
    content: 修复 filler.service.ts 的 dataTableToXml：r[idx] 改为兼容 Record (r[h]) 和 Array (r[idx]) 两种格式
    status: pending
  - id: fix-kv-vmarge
    content: 修复 xml-subtree-inserter.service.ts：fillKeyValueTable 新增 vMerge 预扫描，fillKeyValueRow 新增 inheritedLabels 参数处理合并单元格
    status: pending
    dependencies:
      - fix-datatable-toxml
  - id: compile-restart
    content: 编译 TypeScript 并重启服务器
    status: pending
    dependencies:
      - fix-kv-vmarge
  - id: e2e-verify
    content: 用 [subagent:code-explorer] 端到端验证全部28个表格填充状态，确认列表表/KV表/混合表均正确写入数据
    status: pending
    dependencies:
      - compile-restart
---

## 用户需求

用户报告了两类表格填充问题：

1. **所有列表类表格和混合类表格都没有正确填充数据** — 数据从源头就丢失，源 XML 生成时数据单元格全部为空
2. **键值类表格中，第一列有合并单元格（vMerge）的，后面所有数据都未填充** — 标签配对错位导致后续单元格跳过

## 产品概述

修复报告生成系统中表格数据填充引擎的两个根因级缺陷，确保全部28个模板表格（列表型、键值型、混合型）均能正确写入样例数据。

## 核心功能

### 根因1：`dataTableToXml` 数据访问方式与类型定义不匹配

- `DataTable.rows` 类型定义为 `Record<string, string>[]`（对象数组，每行是 header→value 映射）
- 当前代码 `r[idx]` 用数字索引访问对象 → 返回 `undefined` → 空字符串 → 所有列表/混合表数据丢失
- 需恢复为 `r[h]`（用列名作键），同时兼容 `string[]` 格式以支持测试脚本

### 根因2：`fillKeyValueRow` 不处理 vMerge continue 单元格

- KV 表第一列垂直合并时，continue 行的标签单元格为空（无 `<w:t>` 文本）
- `getCellMergedTexts` 返回空字符串 → `labelText` 为空 → `continue` 跳过
- 该行的值单元格永远不会被填充
- 需要：预扫描行构建 vMerge 标签继承映射，将 restart 行的标签传递给 continue 行

## 技术栈

- TypeScript (Node.js 后端, Express.js)
- Word XML 直接操作（docx unpack/pack 工具链）
- 无前端变更

## 实现方案

### 修复1：`dataTableToXml` 兼容两种数据格式

**文件**: `server/src/services/filler.service.ts` 第949-959行

**问题**: `DataTable.rows` 类型是 `Record<string, string>[]`，当前用 `r[idx]`（数字索引）访问对象返回 `undefined`。

**方案**: 使用列名 `r[h]` 作为主要访问方式，同时检测 `Array.isArray(r)` 兼容 `string[]` 格式：

```typescript
private dataTableToXml(dt: DataTable): string {
  const toTc = (text: string) => `<w:tc><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:tc>`;
  const headerRow = `<w:tr>${dt.headers.map(toTc).join("")}</w:tr>`;
  const dataRows = dt.rows.map(r =>
    `<w:tr>${dt.headers.map((h, idx) => {
      // DataTable.rows 类型为 Record<string, string>[]，用列名作键
      // 同时兼容 string[] 格式（测试脚本可能传入数组）
      const val = Array.isArray(r) ? (r[idx] || "") : (r[h] || "");
      return toTc(val);
    }).join("")}</w:tr>`
  ).join("");
  return `<w:tbl>${headerRow}${dataRows}</w:tbl>`;
}
```

**性能**: O(rows * headers)，无额外开销。**兼容性**: 同时支持 API 调用（`Record`）和测试脚本（`string[]`）。

### 修复2：`fillKeyValueTable` 增加 vMerge 标签继承

**文件**: `server/src/services/xml-subtree-inserter.service.ts`

**问题**: KV 表第一列 vMerge continue 行的标签为空，`fillKeyValueRow` 跳过该行所有值单元格。

**方案**: 在 `fillKeyValueTable` 中预扫描所有行，构建 `vMergeInheritedLabels: Map<number, string>[]`（每行一个 Map，记录该行各列位置继承的标签）。将此 Map 传递给 `fillKeyValueRow`，当 `labelText` 为空时查继承 Map。

**vMerge 检测逻辑**:

- `<w:vMerge w:val="restart"/>` → 记录该单元格文本为活跃合并标签
- `<w:vMerge/>` 或 `<w:vMerge></w:vMerge>` → continue，继承上方最近的 restart 标签
- 无 vMerge → 清除该列的活跃合并状态

**修改点**:

1. `fillKeyValueTable()`: 在遍历行之前，预扫描构建 `vMergeInheritedLabels` 数组
2. `fillKeyValueRow()`: 新增可选参数 `inheritedLabels?: Map<number, string>`，当 `labelText` 为空时查此 Map
3. `extractAllRows()`: 已正确返回所有行（含 vMerge 行），无需修改

### 修改文件清单

| 文件 | 修改内容 | 行号 |
| --- | --- | --- |
| `server/src/services/filler.service.ts` | `dataTableToXml()`: `r[idx]` → 兼容 `r[h]` 和 `r[idx]` | 949-959 |
| `server/src/services/xml-subtree-inserter.service.ts` | `fillKeyValueTable()`: 新增 vMerge 预扫描逻辑 | 429-440 |
| `server/src/services/xml-subtree-inserter.service.ts` | `fillKeyValueRow()`: 新增 `inheritedLabels` 参数 | 487-540 |


## 实现要点

### vMerge 预扫描实现

在 `fillKeyValueTable` 中，遍历 `targetRows` 之前：

```
对每行每列:
  检测 <w:vMerge 在 tc XML 中的出现方式
  if restart → 记录 activeMerges[colIdx] = cellText
  if continue → inherited[rowIdx][colIdx] = activeMerges[colIdx]
  else → 清除 activeMerges[colIdx]
```

### fillKeyValueRow 修改

在 `labelText` 为空时：

```typescript
if (!labelText && inheritedLabels && inheritedLabels.has(i)) {
  labelText = inheritedLabels.get(i);
}
```

### 日志策略

- 使用现有 `logger` 工具
- vMerge 检测到 continue 行时输出 `logger.debug` 级别日志（避免日志爆炸）
- KV 填充成功时输出 `logger.info`

### 爆炸半径控制

- `inheritedLabels` 为可选参数，不传时行为与原来完全一致
- `dataTableToXml` 的 `Array.isArray(r)` 检测确保向后兼容
- 不修改 `getCellMergedTexts`（该函数被多处引用，保持语义不变）
- 不修改 `extractAllRows`、`extractTableDataRows` 等已有方法

## 目录结构

```
server/src/services/
├── filler.service.ts                    # [MODIFY] dataTableToXml(): r[idx] → 兼容 r[h] + r[idx]
├── xml-subtree-inserter.service.ts      # [MODIFY] fillKeyValueTable(): 新增 vMerge 预扫描; fillKeyValueRow(): 新增 inheritedLabels 参数
└── types/
    └── index.ts                         # [不修改] DataTable.rows 类型已正确定义为 Record<string, string>[]
```

## Agent Extensions

### SubAgent

- **code-explorer**
- Purpose: 编译修复后扫描全部28个表格，验证列表表/KV表/混合表的填充状态，确认 vMerge continue 行是否正确继承了标签
- Expected outcome: 输出每个 tableIndex 的填充状态（已填充/未填充）、KV 单元格数、列表数据行数，确认 28/28 全部填充成功