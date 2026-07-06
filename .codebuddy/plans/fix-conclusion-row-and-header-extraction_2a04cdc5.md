---
name: fix-conclusion-row-and-header-extraction
overview: 修复三组填充问题：(1) 结论行被误当作数据行模板导致第二行整行合并；(2) 混合表多行表头列名提取错误；(3) 混合表列名未展开gridSpan导致数据错位。
todos:
  - id: fix-conclusion-row
    content: 在 xml-subtree-inserter.service.ts 中过滤结论行（≤2格+gridSpan≥6）到 preservedAfterData，组装时插入数据行与签名行之间
    status: completed
  - id: fix-hybrid-headers
    content: 在 template-analyzer.service.ts 中将混合表列名提取改为 getCellMergedTextsExpanded，双层表头按vMerge合并两行，空列名替换为列N
    status: completed
  - id: verify-compile
    content: 编译验证 TypeScript 无错误
    status: completed
    dependencies:
      - fix-conclusion-row
      - fix-hybrid-headers
---

## 用户需求

用户报告三组报告填充问题，已纠正问题1的症状描述，要求修复：

### 问题1：第二行整行合并成一个单元格（2-1, 2-3, 2-4, 2-6, 6-1）

第一组样例数据正确，第二组填入后整行水平合并成一个单元格（非垂直合并）。

### 问题2：(3-1) 表头识别缺失

埋地管道外防腐层质量检测报告表格，第2、3行为列表表头，表头识别有缺失，第2行"检测指标(三者选其一)"为合并单元格（gridSpan=5）。

### 问题3：(3-2) 部分列样例数据缺失

埋地管道外防腐层漏点检测报告表格，"漏点情况描述"和"漏点维修记录"列对应的样例数据没有写入。

## 根因分析（已通过模板XML验证）

### 问题1根因：结论行被当作数据行模板

模板2-1表结构：Row 0表头(6格) → Row 1数据行(6格) → Row 2结论行(1格, gridSpan=6, "结论：") → Row 3签名行。

`fillTableFromSource` 中 `templateDataRows = targetRows.slice(headerEndIndex, targetRows.length - 1)` 包含了结论行。当源数据有2行时：i=0填Row 1(正确)，i=1填Row 2(结论行1格gridSpan=6) → `fillRowWithData`将所有逻辑列映射到同一物理格 → 整行显示为一个合并单元格。

### 问题2根因：混合表双层表头列名从错误行提取

3-1表Row 1有"检测指标(三者选其一)"(gridSpan=5)，Row 2有真正列名(电阻率/电流衰减率/破损点密度)。代码在 `hybridListHeaderRows=2` 时仍仅从 `listHeaderStart`(Row 1)提取列名，未合并Row 2。

### 问题3根因：混合表列名未展开gridSpan

3-2表Row 1列头gridSpan=[1,1,2,4,2,2]=12逻辑列。代码用 `getCellMergedTexts`(非展开)返回6个列名，但 `fillRowWithData` 按12逻辑列映射 → data[3](漏点情况描述)映射到已处理的物理格2 → 跳过；物理格4(漏点维修记录)和物理格5(备注)永远不被填充。

## 技术栈

- 后端：Node.js + TypeScript (Express)，OOXML XML 正则操作
- 模板处理：WordprocessingML 直接 XML 操作

## 实现方案

### 修复1：排除结论行（问题1）

**文件**：`server/src/services/xml-subtree-inserter.service.ts`

在 `templateDataRows` 切片后（第144-146行之后），过滤掉结论行（物理格数≤2 且 gridSpan总和≥6），将其存入 `preservedAfterData` 数组。在组装表格XML时（第216-222行），将结论行插入到数据行和签名行之间。

判定条件：物理单元格数≤2 + gridSpan总和≥6 + 非签名行。这覆盖"结论："行(1格gs=6/10)和宽合并行(2格gs=5+5)。

### 修复2+3：混合表列名展开+双层合并（问题2和问题3）

**文件**：`server/src/services/template-analyzer.service.ts` 第278-281行

**单行表头（3-2）**：将 `getCellMergedTexts` 改为 `getCellMergedTextsExpanded`，使列名数量=逻辑列数，与 `fillRowWithData` 的逻辑列映射对齐。

**双层表头（3-1）**：当 `hybridListHeaderRows=2` 时，展开两行表头并按vMerge状态合并：

- Row 2中vMerge=continue的列 → 用Row 1的展开文本（序号/管段起止位置/管段长度/防腐层等级）
- Row 2中非vMerge=continue的列 → 用Row 2的展开文本（电阻率/电流衰减率/破损点密度）

**空列名处理**：展开后空列名替换为 `列N`，避免 `generateSampleRows` 中Record键冲突。

### 实现备注

- **性能**：正则和数组操作均为O(n)，不影响性能
- **回归风险**：
- 修复1：结论行过滤条件严格（≤2格+大gridSpan），不会误过滤正常数据行
- 修复2+3：`getCellMergedTextsExpanded` 已在本文件第938行定义并使用，改为展开版不影响非gridSpan表格（gridSpan=1时展开结果与非展开一致）
- 双层表头合并的vMerge判断复用已有 `analyzeRowCells` 函数
- **影响范围**：不涉及API接口变更，不涉及前端修改

## 目录结构

```
server/src/services/
├── xml-subtree-inserter.service.ts  # [MODIFY] 第144-155行：过滤结论行到preservedAfterData；第216-222行：组装时插入结论行
└── template-analyzer.service.ts     # [MODIFY] 第278-281行：混合表列名改用展开版+双层合并
```