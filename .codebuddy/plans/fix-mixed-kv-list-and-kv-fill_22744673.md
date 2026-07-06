---
name: fix-mixed-kv-list-and-kv-fill
overview: 修复混合KV+List表格检测缺失和KV填充仍失效两个问题：在analyze()中新增混合表检测，在fillKeyValueRow中统一使用getCellMergedTexts提取标签文本
todos:
  - id: rc2-deep-refactor
    content: RC2深化：xml-subtree-inserter.service.ts 导入 getCellMergedTexts，fillKeyValueRow 整行提取重构
    status: completed
  - id: rc5-types
    content: RC5类型扩展：TemplateTable 新增 isHybrid、hybridListHeaderRows 可选字段
    status: completed
  - id: rc5-analyze
    content: RC5分析检测：analyze() 新增混合表启发式检测，仅从 Row 0 提取 kvKeys，从 Row 1+ 提取 columns
    status: completed
    dependencies:
      - rc5-types
  - id: rc5-sample
    content: RC5样例生成：generateSampleData() 新增 isHybrid 分支，同时产出 kvPairs 和 tables
    status: completed
    dependencies:
      - rc5-analyze
  - id: rc5-filltable
    content: RC5填充适配：fillTableFromSource 新增 dataStartRow 参数，表头检测从指定行起始
    status: completed
    dependencies:
      - rc5-types
  - id: rc5-filler-coordinate
    content: RC5填充协调：fillBySubtreeCopyV2 对混合表先 KV 后 List，传递 dataStartRow 跳过列表表头区
    status: completed
    dependencies:
      - rc5-filltable
      - rc5-sample
  - id: compile-verify-all
    content: 编译验证 npx tsc --noEmit，确保零错误，并检查所有调用点参数兼容
    status: completed
    dependencies:
      - rc2-deep-refactor
      - rc5-filler-coordinate
---

## 用户需求

发现两个新问题：

1. **混合 KV+List 表格未处理**：如"（3-1）埋地管道外防腐层质量检测报告"，Row 0 是键值对行（检测项目 | XXX | 检测日期 | XXX …），Row 1+ 是列表型（序号 | 测点位置 | 检测结果 | …）。当前 `isKeyValueTable()` 二元分类将整个表判为 KV，导致列表数据全部丢失；若不判为 KV，则 Row 0 键值数据丢失。

2. **键值类表格内容仍然没有正确填充数据**：前一轮仅在 `getAllWtText` 中添加 `<` 过滤，但未按计划要求导入 `getCellMergedTexts` 并重构 `fillKeyValueRow`。两种函数在处理 gridSpan 合并单元格时行为存在差异，导致标签 Key 匹配偏移。

## 核心修复目标

- RC2-深：在 `fillKeyValueRow` 中导入并使用 `getCellMergedTexts` 提取标签文本，彻底统一 analyze 和 fill 阶段
- RC5：检测混合 KV+List 表格，分析阶段同时提取 kvKeys（Row 0）和 columns（Row 1+），填充阶段先 KV 后 List 协调处理

## 技术方案

### RC2 深化 — fillKeyValueRow 重构为 getCellMergedTexts

**文件**：`server/src/services/xml-subtree-inserter.service.ts`

**当前实现缺陷**：

- `fillKeyValueRow()` 第 456 行使用 `this.getAllWtText(labelTc.content)` 逐个单元格提取标签文本
- `analyze()` 使用 `getCellMergedTexts(tr.content)` 整行提取
- 虽然 `<` 过滤已统一，但 `getCellMergedTexts` 在 `<w:tc>` 边界处理上更精准（确保偶数/奇数位配对不受 gridSpan 干扰）

**修改**：

1. 第 1-6 行导入区新增 `getCellMergedTexts`
2. 重构 `fillKeyValueRow`：调用 `getCellMergedTexts(rowXml)` 得到整行 cells 数组，用 `rowCells[i]` 替代 `this.getAllWtText(labelTc.content)`
3. 保留 `tcMatches` 数组用于 XML 索引定位和替换
4. 值单元格空值判断也改用 `rowCells[i+1]`，确保一致

```typescript
// 核心变更伪代码
const rowCells = getCellMergedTexts(rowXml);       // 整行提取（与 analyze 一致）
const tcMatches = this.buildTcMatches(rowXml);      // 保留用于 XML 替换
for (let i = tcMatches.length - 2; i >= 0; i -= 2) {
    const labelText = rowCells[i];                  // ← 改用 getCellMergedTexts 结果
    const sourceValue = sourceKvMap.get(labelText);
    if (!sourceValue) continue;
    const valueText = rowCells[i + 1];             // ← 同样改用
    if (valueText && !/^\s*$/.test(valueText)) continue;
    // ... XML 替换逻辑不变（使用 tcMatches[i+1]）
}
```

---

### RC5 — 混合 KV+List 表格检测与填充

涉及 **3 个文件**：类型定义、模板分析器、XML 填充器

#### 5a. 类型扩展

**文件**：`server/src/types/index.ts`

在 `TemplateSection.tables` 元素类型中新增两个可选字段：

```typescript
tables: {
    tableIndex: number;
    isKeyValue: boolean;
    isHybrid?: boolean;              // NEW: 混合表标记
    hybridListHeaderRows?: number;   // NEW: 列表表头行数（含列名行）
    kvKeys?: string[];
    columns?: { header: string; mappedField: string }[];
}[];
```

#### 5b. 分析阶段：混合表检测

**文件**：`server/src/services/template-analyzer.service.ts`

在 `analyze()` 中 `isKv = isKeyValueTable(tbl)` 之后（第 41 行），新增混合检测逻辑：

**检测启发式**：

1. Row 0 单元格数 ≥ 6（足够多的 KV 对）
2. Row 0 奇数位（值列）有非空内容（有实际数据而非空模板）
3. Row 1 单元格数 ≥ 3 且与 Row 0 数量不同（列表列名行特征）
4. 表格总行数 ≥ 4（有数据行空间）

**检测通过后**：

- 设置 `isHybrid = true`，`isKeyValue = false`
- kvKeys 仅从 Row 0 提取（不是所有行）
- columns 从 Row 1 提取（或 Row 1-2 通过多层检测）
- 记录 `hybridListHeaderRows` = 列表表头区行数
- 标题仍从 Row 0 首格提取（可能是表格编号）

```typescript
// 伪代码
const allTrMatches = findAllTags(tbl, "w:tr");
const row0Cells = getCellMergedTexts(allTrMatches[0].content);
const row1Cells = allTrMatches.length > 1
    ? getCellMergedTexts(allTrMatches[1].content) : [];

const isHybrid =
    allTrMatches.length >= 4 &&
    row0Cells.length >= 6 &&
    row1Cells.length >= 3 &&
    row0Cells.length !== row1Cells.length &&
    hasKvPairsInRow(row0Cells);  // 辅助：偶数位短标签 + 奇数位有值

if (isHybrid) {
    // 仅 Row 0 提取 kvKeys
    // 从 Row 1 开始检测列表表头
    // 记录 hybridListHeaderRows
}
```

**辅助函数** `hasKvPairsInRow(cells)`：遍历偶数位，检查是否有 ≥ 3 个短标签（< 10 字符）且对应奇数位有值。

#### 5c. 样例数据生成：同时产出 kvPairs 和 tables

**文件**：`server/src/services/template-analyzer.service.ts` — `generateSampleData()`

在遍历 `sec.tables` 时：

```typescript
if (tbl.isHybrid) {
    // 同时生成 kvPairs（从 kvKeys）和 tables（从 columns）
    const keys = tbl.kvKeys || [];
    for (const key of keys) {
        secData.kvPairs.push({ key, value: sampleKvValue(key) });
    }
    const headers = (tbl.columns || []).map(c => c.header);
    const rows = generateSampleRows(headers, 2);
    secData.tables.push({ tableType: `entity_${i}`, headers, rows });
}
```

#### 5d. 填充阶段：KV 先填后 List 协调

**文件**：`server/src/services/filler.service.ts` — `fillBySubtreeCopyV2()`

混合表填充顺序：先 `fillKeyValueTable`（填 Row 0），再 `fillTableFromSource`（填 Row 1+ 列表区）。`xml` 变量在两次调用间传递，确保 KV 结果对 List 填充可见。

关键：给 `fillTableFromSource` 增加 `dataStartRow` 可选参数。

#### 5e. fillTableFromSource：新增 dataStartRow 参数

**文件**：`server/src/services/xml-subtree-inserter.service.ts`

新增可选参数 `dataStartRow: number = 1`（默认 1 = 跳过 Row 0）：

```typescript
fillTableFromSource(
    targetXml: string,
    targetTableIndex: number,
    sourceTableXml: string,
    signatureText: string = "",
    dataStartRow: number = 1    // NEW：表头区起始行号
): { xml: string; rowsFilled: number }
```

内部逻辑变更（第 70-83 行 header 检测循环）：

- 从 `dataStartRow` 开始扫描（原来从 0 开始）
- 将 `dataStartRow` 之前的所有行预先加入 headerRows
- RC3 多层检测起点同步调整

对于纯列表型表：`dataStartRow = 1`（默认，与原行为一致）
对于混合表：`dataStartRow = 1 + hybridListHeaderRows`（KV 行后跳过列表表头）

**调用方变更**（`filler.service.ts` 第 838-839 行）：

```typescript
const dataStartRow = section.hybridListHeaders ? section.hybridListHeaders : 1;
const fillResult = xmlSubtreeInserter.fillTableFromSource(
    xml, tableIndex, srcXml, sigText, dataStartRow
);
```

---

### 不变更部分

- `SectionData` 接口不变（自身已有 `kvPairs` 和 `tables` 两个槽位）
- `TemplateSection` 接口仅追加可选字段，向后兼容
- `fillKeyValueTable` 整体流程不变
- `isKeyValueTable()` 函数本身不变（混合检测在其结果之上做二次判断）
- RC1/RC3/RC4 已实现代码不变

### 涉及文件汇总

```
server/src/
├── types/
│   └── index.ts                              # [MODIFY] TemplateTable 新增 isHybrid, hybridListHeaderRows
├── services/
│   ├── template-analyzer.service.ts           # [MODIFY] analyze() 新增混合表检测, generateSampleData() 新增 isHybrid 分支
│   ├── xml-subtree-inserter.service.ts        # [MODIFY] RC2 fillKeyValueRow 重构为 getCellMergedTexts; RC5 fillTableFromSource 新增 dataStartRow
│   └── filler.service.ts                     # [MODIFY] fillBySubtreeCopyV2() 混合表协调传递 dataStartRow
└── utils/
    └── xml-utils.ts                          # [不变] 已导出 getCellMergedTexts
```

## Agent Extensions

无可用 MCP/Skill/SubAgent/Integration 适用于本次纯后端逻辑修改。