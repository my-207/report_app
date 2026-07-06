---
name: fix-table-fill-root-causes
overview: 修复表格数据填充失败的5个根因：dataMerger丢失关键字段、降级匹配零日志、旧版填充阈值过高、空行检测缺陷、KV表空跳过
todos:
  - id: fix-datamerger-fields
    content: 修复 data-merger.service.ts merge() 补全丢失的 tableIndex/hasHybridTable/hybridListHeaderRows 字段
    status: completed
  - id: fix-v2-logs-and-kv-skip
    content: 修复 filler.service.ts V2流程：添加降级匹配失败的三处诊断日志 + 放宽 KV 表跳过条件
    status: completed
  - id: fix-old-threshold-and-empty-row
    content: 修复 filler.service.ts 旧版流程：降低匹配阈值 0.5→0.35 + 宽松空行检测替代严苛 isRowEmpty
    status: completed
  - id: compile-verify
    content: 编译验证：执行 tsc --noEmit 确保所有修改编译零错误
    status: completed
    dependencies:
      - fix-datamerger-fields
      - fix-v2-logs-and-kv-skip
      - fix-old-threshold-and-empty-row
---

## 用户需求

用户反馈"原来未正确填充数据的表格，仍然未实现数据填充"。经过对三条填充路径（旧版 `/api/fill`、子树复制 `/api/fill-by-copy`、新版 `/api/fill-with-data`）的完整分析，定位出 5 个独立根因，需要逐一修复。

## 核心修复内容

- 修复 `dataMerger.merge()` 丢失 `tableIndex`、`hasHybridTable`、`hybridListHeaderRows` 三个关键字段
- 为新版 V2 填充流程的所有降级匹配失败路径添加 `logger.warn` 诊断日志
- 将旧版 `fillTables()` 表头匹配阈值从 0.5 降至 0.35，与新版一致
- 修复旧版 `fillSingleTable()` 仅填充空行的策略，改为逐单元格替换包含模板占位文本的行
- 降低 V2 填充中 KV 表的跳过门槛，`section.hasHybridTable` 为 true 时即使 kvPairs 为空也尝试填充

## 技术栈

- 后端：Node.js + TypeScript + Express
- XML 操作：直接操作 Word 文档底层 XML（w:t、w:tbl、w:tr、w:tc 标签）
- 服务层：filler.service.ts（三套填充引擎）、data-merger.service.ts（双源数据合并）

## 修改策略

### 根因1：dataMerger 丢失关键字段

**位置**：`server/src/services/data-merger.service.ts`

**问题**：`merge()` 方法构建 `SectionData` 时只复制了 `id`、`title`、`kvPairs`、`tables`、`signature` 五个字段，未保留 `tableIndex`、`hasHybridTable`、`hybridListHeaderRows`。

**修复**：在两处 `sectionMap.set()` 调用中补全这三个字段：

- 第42-48行（MD 数据优先分支）：展开 s 后显式补全
- 第74行（.rj 新章节分支）：`{ ...s }` 已展开全部字段，但需确认

### 根因2：降级匹配失败零诊断日志

**位置**：`server/src/services/filler.service.ts` 第850-877行

**问题**：`fillBySubtreeCopyV2()` 中，当 `tableIndex === undefined` 且精确匹配 + 宽松匹配均失败时，无任何日志输出，无法排查。

**修复**：在三处添加 `logger.warn`：

- `findMatchingTemplateTable() === null` 时记录源表头信息
- `findMatchingTemplateTableLoose() === null` 时记录最终匹配失败
- `fillResult.rowsFilled === 0` 时记录警告（tableIndex 模式下也有此情况）

### 根因3：旧版 fillTables 阈值 0.5 过高

**位置**：`server/src/services/filler.service.ts` 第663行

**修复**：将 `matchScore < 0.5` 改为 `matchScore < 0.35`，与新版 V2 流程一致。

### 根因4：旧版 fillSingleTable 仅填充空行

**位置**：`server/src/services/filler.service.ts` 第683-690行

**问题**：`isRowEmpty()` 检查 `<w:t>` 文本是否全部为空字符串。模板中常有占位文本（如 &quot;——&quot;、&quot;示例&quot;、&quot;待填&quot;），这些行不被识别为空行。

**修复**：将空行检测改为宽松模式——在 `isRowEmpty` 检查之外，额外检测行文本是否仅包含短占位符（长度 &lt;= 3 且不含中文字符）。对于这些&quot;准空行&quot;，同样执行数据填充。

### 根因5：V2 KV 表填充跳过条件过严

**位置**：`server/src/services/filler.service.ts` 第805行

**问题**：`if (section.kvPairs.length &gt; 0)` 为假时完全跳过 KV 填充。混合表的 KV 部分若数据暂缺，模板中的 KV 行保持未填充状态。

**修复**：改为 `if (section.kvPairs.length &gt; 0 || section.hasHybridTable)`，混合表场景下即使 kvPairs 为空也尝试调用 `fillKeyValueTable()`，让 `fillKeyValueTable()` 内部自行判断是否有可填充的键值对。

## 目录结构

```
server/src/services/
├── data-merger.service.ts  # [MODIFY] merge() 补全 tableIndex/hasHybridTable/hybridListHeaderRows
└── filler.service.ts       # [MODIFY] 三处修改:
                            #   1. 第652-663行: 阈值 0.5→0.35
                            #   2. 第683-690行: 宽松空行检测
                            #   3. 第850-877行: 添加诊断日志 + 第805行放宽KV跳过条件
```

## Agent Extensions

### SubAgent

- **code-explorer**
- Purpose: 在 plan 确认后执行实现时，用于搜索确认所有需要添加日志的静默跳过路径和补全字段的正确来源
- Expected outcome: 验证所有修改点准确无误，确保无遗漏的跳过路径