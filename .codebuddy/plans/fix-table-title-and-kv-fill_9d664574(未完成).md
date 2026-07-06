---
name: fix-table-title-and-kv-fill
overview: 修复表格标题泛型化、KV表标签提取不一致、多层表头截断、跨页拆分表格四个根因，涉及 4 个文件
todos:
  - id: fix-rc1-title
    content: "RC1: 在 analyze() 中提取合并标题行文本编码到 sectionId（table_N::标题），generateSampleData() 解析使用"
    status: pending
  - id: fix-rc2-kv-label
    content: "RC2: xml-subtree-inserter.service.ts 导入 getCellMergedTexts，fillKeyValueRow 改用统一函数提取标签"
    status: pending
  - id: fix-rc3-multilayer-header
    content: "RC3: fillTableFromSource() 将双层表头补丁扩展为通用多层检测（单元格数比较启发式）"
    status: pending
  - id: fix-rc4-split-table
    content: "RC4: analyze() 检测跨页拆分表格（无标题行 + 行少 + 列与前一表相似），复用 lastColumns"
    status: pending
  - id: compile-verify-all
    content: 编译验证 npx tsc --noEmit，确认零错误
    status: pending
    dependencies:
      - fix-rc1-title
      - fix-rc2-kv-label
      - fix-rc3-multilayer-header
      - fix-rc4-split-table
---

## 用户需求

经过前两轮修复（双层表头检测 + KV 表识别），用户报告仍然存在以下问题：

1. **表格 title 写入泛型名称**：generateSampleData 生成 `title: "表格区域 table_N"`，应写入实际表格名称（如"表1-4 壁厚测定记录"）
2. **所有 KV 表未正确填充**：analyze 和 fillKeyValueRow 使用了不同的标签提取函数，导致 Key 不匹配
3. **列表型表格大量未正确写入**：

- 1-4、2-2、2-5、2-6、2-8、3-1、3-2、4、5-1、5-2、5-4后半、5-5、5-6、5-7、6-1、6-2 全部失败
- 2-1 只填了 1 行（应填 2 行）

## 已确认根因 (RC1-RC4)

| 编号 | 根因 | 严重程度 |
| --- | --- | --- |
| RC1 | 表格标题泛型化：合并标题行文本未被提取为 section title | 高 |
| RC2 | KV 标签提取函数不一致：analyze 用 `getCellMergedTexts`，fillKeyValueRow 用 `getAllWtText` | 致命 |
| RC3 | 三层表头截断：多层检测最多识别 2 层，第 3 层被当作数据行 | 高 |
| RC4 | 跨页拆分表格：后半部分无表头，analyze 把首行数据误解为 columns | 高 |


## 技术方案

### RC1 — 表格标题替换为实际名称

**文件**：`server/src/services/template-analyzer.service.ts`

**策略**：在 `analyze()` 中提取表格第一行的合并标题文本，编码到 `sectionId` 中（格式 `table_N::实际标题`），`generateSampleData()` 解析使用。不修改任何类型接口。

**analyze() 修改**（第 42-52 行附近）：

- 在提取 `headers = getCellMergedTexts(firstTr)` 之后，保存原始第一行文本作为 `rawTitle`
- 构建 `sectionId` 时：如果 `!isKv && rawTitle` 有内容（非空非长），则 `sectionId = 'table_${tblIdx}::${rawTitle}'`
- KV 表也用同样逻辑提取标题（合并标题行通常在 row0）

**generateSampleData() 修改**（第 177 行）：

```typescript
// 解析 sectionId 中的标题
const [tableId, ...titleParts] = sec.sectionId.split("::");
const title = titleParts.length > 0 ? titleParts.join("::") : `表格区域 ${tableId}`;
```

---

### RC2 — KV 表标签提取统一为 `getCellMergedTexts`

**文件**：`server/src/services/xml-subtree-inserter.service.ts`

**问题**：`fillKeyValueRow()` 第 456 行用 `getAllWtText(labelTc.content)` 提取标签文本，与 `analyze()` 使用的 `getCellMergedTexts()` 不一致。`getCellMergedTexts` 有 `!t.startsWith("<")` 过滤，而 `getAllWtText` 没有。模板单元格中的 `<w:t>` 如果包含以 `<` 开头的文本片段（XML 转义残留），analyze 会过滤掉但 fillKeyValueRow 不会 → 两种路径得到不同的标签字符串 → `sourceKvMap.get(labelText)` 返回 undefined → 静默跳过。

**修改**：

1. 第 1-6 行导入区新增 `getCellMergedTexts`：

```typescript
import { extractTagContent, extractWtTexts, isRowEmpty, getCellMergedTexts } from "../utils/xml-utils";
```

2. 第 456 行替换：

```typescript
// 修改前：const labelText = this.getAllWtText(labelTc.content);
// 修改后：使用与 analyze() 一致的 getCellMergedTexts
const rowCells = getCellMergedTexts(rowXml);  // 整行提取
const labelText = rowCells[i];                 // 直接索引取标签
```

3. 重构 `fillKeyValueRow`：改为先对整个 rowXml 调用 `getCellMergedTexts` 得到 cells 数组，然后用索引 `i`、`i+1` 取标签和值。每行的 labelCell/valueCell 配对逻辑不变，但从 `getCellMergedTexts` 结果中取而非从 `getAllWtText` 中取。

---

### RC3 — 三层表头通用多层检测

**文件**：`server/src/services/xml-subtree-inserter.service.ts`，`fillTableFromSource()` 第 72-98 行

**当前逻辑**（仅处理 2 层）：

```
for i=0..n: if(i==0 || hasVMerge || hasGridSpan) → 表头; else break
双层补丁: if headerEndIndex==1 && row1CellCount > row0CellCount → headerEndIndex=2
```

三层表头场景：

```
Row 0: "表1-4 壁厚测定记录" (gridSpan, 1-2 cells)  → 表头层1
Row 1: "公称壁厚: 8.0mm   材质: 20#钢" (gridSpan, 2-4 cells) → 表头层2  
Row 2: "序号 | 测点 | 实测厚度 | ..."  (8 cells, 无gridSpan) → 列名行（需纳入表头！）
Row 3+: 数据行
```

当前双层补丁只能扩展 1 行 (headerEndIndex=2)，丢失了 Row 2。

**修改**：将双层补丁改为**通用多层检测**——从 row 1 开始向前扫描，连续将「单元格数 ≤ 4 且比下一行少」的行纳入表头区，直到遇到「单元格数 ≥ 5 的行」(列名行)为止。列名行本身也纳入表头。

```typescript
// 替换原第 85-98 行
if (headerEndIndex === 1 && targetRows.length > 2) {
  const row0CellCount = (targetRows[0].xml.match(/<w:tc[ >]/g) || []).length;
  // 从 row1 开始，找到单元格数最多的行作为列名行
  let maxCellRowIdx = 1;
  let maxCellCount = (targetRows[1].xml.match(/<w:tc[ >]/g) || []).length;
  for (let i = 2; i < targetRows.length - 1; i++) {
    const count = (targetRows[i].xml.match(/<w:tc[ >]/g) || []).length;
    if (count > maxCellCount) { maxCellCount = count; maxCellRowIdx = i; }
  }
  // 如果找到的列名行单元格数远多于 row0，将 row0~maxCellRowIdx 全部纳入表头
  if (maxCellCount > row0CellCount && maxCellCount >= 3) {
    for (let i = 1; i <= maxCellRowIdx; i++) {
      headerRows.push(targetRows[i].xml);
    }
    headerEndIndex = maxCellRowIdx + 1;
  }
}
```

---

### RC4 — 跨页拆分表格检测

**文件**：`server/src/services/template-analyzer.service.ts`，`analyze()` 第 36-120 行

**特征识别**：跨页拆分的后半表格具有：无合并标题行(row0 ≥ 5 cells) + 行数少(≤ 3行非空) + 首行包含数字 + 列数与前一表格相似。

**修改**：在 `while` 循环处理每个 `<w:tbl>` 时，维护一个 `lastColumns: string[]` 变量。对每个列表型表格，检测：

1. row0 单元格数 ≥ 5（无标题行特征）
2. 表格总行数 ≤ 4  
3. `lastColumns` 已存在且当前 columns 是 lastColumns 的子集或近似匹配
→ 标记为 continuation，**复用 lastColumns 作为当前表格的 columns**，不修改 sectionId 前缀（保持独立 tableIndex 用于填充定位）。

```typescript
// analyze() 函数开头新增
let lastColumns: string[] = [];

// 在列表型表格分支（else 块），构建 columns 后：
const currentColumns = headers; // headers 已通过双层检测
if (lastColumns.length > 0
    && headers.length >= 5  // 无标题行特征
    && allTrMatches.length <= 4  // 行数少
    && isSubsetOrSimilar(headers, lastColumns)) {
  // 拆分表格后半 → 复用前半的 columns
  headers = lastColumns;
  logger.info(`检测到拆分表格: table_${tblIdx} 复用前表 columns`);
}
lastColumns = [...headers];

// 辅助函数
function isSubsetOrSimilar(a: string[], b: string[]): boolean {
  if (a.length === 0 || b.length === 0) return false;
  const matches = a.filter(ah => b.some(bh => bh.includes(ah) || ah.includes(bh)));
  return matches.length >= Math.min(a.length, b.length) * 0.4;
}

```

---

### 不变更部分

- `SectionData`、`TemplateSection`、`UnifiedReportData` 类型接口不修改
- RC1 标题通过 sectionId 编码传递（`table_N::标题`），不影响数据流协议
- `fillBySubtreeCopyV2()` 排序和填充逻辑不变
- `fillKeyValueTable` 整体算法流程不变，仅改标签提取函数

### 涉及文件汇总

```
server/src/
├── services/
│   ├── template-analyzer.service.ts    # RC1 + RC4
│   └── xml-subtree-inserter.service.ts # RC2 + RC3
└── utils/
    └── xml-utils.ts                    # 已导出 getCellMergedTexts，无需改动
```