---
name: fix-sample-fill-table-bugs
overview: 修复样例数据填充中大量表格数据缺失的根因：analyze()表头提取只取第一行（漏掉合并标题行后的列名行）、fillTableFromSource表头检测在无gridSpan的行处break（列名行被当作数据行覆盖）、源数据列数与模板列数不匹配（导致只填充1列）、目录/结论/附页表格未识别。
todos:
  - id: fix-analyze-headers
    content: 修复 template-analyzer.service.ts analyze() 双层表头提取：当第一行是合并标题行时，从第二行提取真实列名作为 columns
    status: pending
  - id: fix-fill-header-detect
    content: 修复 xml-subtree-inserter.service.ts fillTableFromSource() 表头检测：在 vMerge/gridSpan 检测后补充单元格数比较，将列名行纳入表头区域
    status: pending
  - id: add-mismatch-warning
    content: 在 xml-subtree-inserter.service.ts fillTableFromSource() 中添加源数据与模板列数不匹配的诊断日志
    status: pending
    dependencies:
      - fix-fill-header-detect
  - id: verify-compile
    content: 编译验证 npx tsc --noEmit，确保零错误
    status: pending
    dependencies:
      - fix-analyze-headers
      - fix-fill-header-detect
      - add-mismatch-warning
---

## 问题诊断

用户报告使用"样例数据填充"后，大量表格未正确写入数据。

### 症状

- **目录、结论报告、检查报告附页**三个表格完全不在数据结构A中
- 具体表格未正确填写：1-1、1-4、2-2、2-5、2-6、2-8、3-1、3-2、4、5-1、5-2、5-4后半部分、5-5、5-6、5-7、6-1、6-2

### 根因链

模板表格典型结构为双层表头：合并标题行(row 0, 含 `w:gridSpan`) + 列名行(row 1) + 数据行 + 签名行。两个 bug 串联导致列名行丢失、数据只填了一个单元格：

**Bug 1 — analyze() 只提取第一行作为表头** (`template-analyzer.service.ts:43-52`)
`headers = getCellMergedTexts(firstTr)` 只取 row 0。当 row 0 是合并标题行（如"表1-4 壁厚测定记录"），headers 仅含 1 个元素 → columns 只有 1 列 → 样例 DataTable 只有 1 列 → 源数据只有 1 列。

**Bug 2 — fillTableFromSource 表头检测过早 break** (`xml-subtree-inserter.service.ts:72-83`)
检测到 row 0 有 gridSpan → 识别为表头；row 1 无 gridSpan/vMerge → 立即 break，headerEndIndex = 1。row 1（列名行）被错误地当作数据行模板，被源数据第一行覆盖。

**Bug 2+3 — 列数不匹配导致数据丢失** (`xml-subtree-inserter.service.ts:268-269`)
源数据只有 1 列（Bug 1 产物），模板行有 8-10 列。`fillRowWithData` 的 `colIdx >= data.length` 跳过 colIdx >= 1 的所有单元格，只填了第 1 个单元格，其他全空。列名"序号""测点位置"等被覆盖。

### 影响范围

所有具有「合并标题行 + 列名行」双层表头结构的列表型表格均受影响。键值对表格（KV table）不受此影响。

## 技术方案

### 修复策略

三个修改点，沿模板分析→填充引擎两条线同时修复：

1. **分析阶段修复表头提取**：`analyze()` 检测第一行是否为合并标题行，若是则从第二行提取真实列名
2. **填充阶段修复表头检测**：`fillTableFromSource()` 在 vMerge/gridSpan 检测后，补一个行单元格数比较，将列名行纳入表头区域
3. **添加列数不匹配诊断日志**：`fillTableFromSource()` 中比较源数据列数与模板行列数，不匹配时输出 warning

### 关键设计决策

- **双线修复**：分析阶段和填充阶段各自独立修复，即使只有一面修复也能改善结果，两面结合完全解决问题
- **不修改数据流协议**：`SectionData`、`DataTable`、`TemplateSection` 接口不变，只修正数据生成逻辑
- **单元格数比较启发式**：row 0 有 1-2 个 cell 且 row 1 有 3+ 个 cell → row 0 是标题行，row 1 是列名行。兼容无标题行的简单表格（row 0 直接是列名行）

### 涉及文件

```
server/src/services/
├── template-analyzer.service.ts       # [MODIFY] analyze() 智能提取双层表头
├── xml-subtree-inserter.service.ts    # [MODIFY] fillTableFromSource() 表头检测补全 + 列数警告
└── filler.service.ts                  # 不变（上轮已修复 KV 循环和倒序处理）
```

### 实现细节

**template-analyzer.service.ts — analyze() 修改位置（43-52 行之后）**

在现有 `headers = getCellMergedTexts(...)` 之后，添加：

```
if (headers.length <= 2 && !isKv) {
    提取第二行 → secondHeaders = getCellMergedTexts(...)
    if (secondHeaders.length > headers.length) → headers = secondHeaders
}
```

逻辑：第一行 1-2 个单元格且非 KV 表，第二行有更多单元格 → 用第二行作为 columns 来源。

**xml-subtree-inserter.service.ts — fillTableFromSource() 修改位置（83 行之后）**

在 `for` 循环（表头检测）之后、`headerEndIndex >= targetRows.length - 1` 检查之前，添加：

```
if (headerEndIndex === 1 && targetRows.length > 2) {
    统计 row0 和 row1 的 <w:tc> 数量
    if (row1CellCount > row0CellCount) {
        headerRows.push(row1.xml)
        headerEndIndex = 2
    }
}
```

同时在 `fillRowWithData` 调用前，添加源数据列数与模板行列数的比较日志。