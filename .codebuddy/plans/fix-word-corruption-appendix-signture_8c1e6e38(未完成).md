---
name: fix-word-corruption-appendix-signture
overview: 修复三个问题：1) Word打不开（XML未转义导致非法字符）；2) 附页表格格式识别（(1-1)(1-3)(2-2)表格类型和结构检测）；3) 签名行日期填写不全（replaceMultiRunDate和签名锚点匹配）
todos:
  - id: fix-xml-escaping
    content: 修复XML特殊字符转义：在 filler.service.ts 的 dataTableToXml 和 kvToXml 中添加 escapeXml 转义，并在 fillBySubtreeCopyV2 末尾添加 validateFilledDocument 格式校验调用
    status: pending
  - id: fix-table-analyzer
    content: 重构 template-analyzer.service.ts 表格识别：新增 analyzeRowCells 逐单元格扫描函数，增强混合表检测逻辑以正确识别(1-1)的KV区域/文本区域/签名行，(1-3)和(2-2)的列表表结构
    status: pending
  - id: fix-signature-dates
    content: 修复签名行日期占位符替换：扩展 replaceDatePlaceholders 正则以匹配部分确定日期格式(202X年6月17日)，修复 replaceMultiRunDate 起始匹配逻辑，确保三个表格签名行日期完整填入
    status: pending
  - id: end-to-end-verify
    content: 端到端验证：启动服务器，上传模板和样例数据，生成报告，验证Word可正常打开且三个表格格式正确、签名日期完整
    status: pending
    dependencies:
      - fix-xml-escaping
      - fix-table-analyzer
      - fix-signature-dates
---

## 用户需求

修复年度检查报告自动填充系统的三个问题：

### 1. 生成的报告Word打不开

生成的.docx文件无法被Microsoft Word正常打开，文件已损坏。

### 2. "XXXXXX年度检查报告附页"表格格式识别错误

附页部分的三个表格需要重新识别，要求逐行逐列逐个单元格检测，根据逻辑识别标签和所需填充的值：

- **(1-1)原始资料审查报告** — 17行5列的混合表（KV键值对+问题记载文本区+签名行）
- **(1-3)管道施工改造情况报告** — 3行6列的纯列表表（表头+1行数据+签名行）
- **(2-2)地面装置检查报告** — 7行10列的纯列表表（表头+2行数据+结论行+签名行）

### 3. 多个表格签名行日期填写不全

(1-1)、(1-3)、(2-2)三个表格的签名行中日期占位符未被正确替换为实际日期。(1-1)中日期格式为`202X年6月17日`（月份日期已确定但年份含占位符X），而通用替换模式仅匹配全占位符格式`202X年X月XX日`。

## 技术栈

- 后端：Node.js + TypeScript + Express
- XML处理：正则表达式 + adm-zip
- 模板分析：基于正则的XML解析器

## 修复方案

### 修复一：XML特殊字符转义（解决Word打不开）

**根因**：`filler.service.ts` 中 `dataTableToXml` 和 `kvToXml` 方法的 `toTc` 闭包直接拼接 `${text}` 到XML中，未对 `&`、`<`、`>`、`"` 进行转义。任何包含这些字符的数据都会生成非法XML，导致Word拒绝打开文档。

**修复方式**：

1. 在 `filler.service.ts` 中复用 `xml-subtree-inserter.service.ts` 已有的 `escapeXml` 方法（第938-944行），或者内联一个独立的转义函数
2. 修改 `toTc` 闭包：`` const toTc = (text: string) => `<w:tc><w:p><w:r><w:t>${escapeXml(text)}</w:t></w:r></w:p></w:tc>` ``
3. 在 `fillBySubtreeCopyV2` 末尾（保存XML后、返回结果前）添加 `validateFilledDocument` 格式校验调用，对齐 `fillBySubtreeCopy` 的校验逻辑

### 修复二：附页表格逐单元格重新识别

**根因**：`isKeyValueTable` 函数和 `template-analyzer.service.ts` 对表格类型的判断未充分考虑 gridSpan 和 vMerge 混合场景。混合表检测（`isHybrid`分支）的条件 `row0RawCells.length >= 4 && row1Cells.length >= 3 && kvPairCount >= 2 && row0IsKvRow` 使用Row1的格数作为列表判断依据，但三个表格的数据行结构各不相同。

**修复方式**：重构 `template-analyzer.service.ts` 的表头行检测逻辑，采用逐行逐单元格扫描策略：

1. **新增 `analyzeRowCells` 工具函数**：对每一行提取所有单元格信息（text、gridSpan、vMerge状态、tcW列宽），输出行的逻辑列展开数组
2. **增强表头行检测**：在 `getCellMergedTextsExpanded` 基础上，考虑gridSpan跨列单元格的展开，确保表头文本列数与数据行列数一致
3. **增强混合表检测**：

- 使用新的 `analyzeRowCells` 函数扫描表格每一行
- 逐行判断行类型：KV行（偶数位有标签且值位为空）、合并标题行（gridSpan≥3）、文本区域行（gridSpan覆盖几乎所有列）、签名行（含签名关键词）
- 将(1-1)的1-14行正确识别为KV区域，15-16行识别为文本区域，17行识别为签名行

4. **修复 kStartIdx 逻辑**：对于(1-1)的第13-14行vMerge场景，正确跳过vMerge continue单元格并提取vMerge restart行中的标签

### 修复三：签名行日期占位符完整替换

**根因**：`replaceMultiRunDate` 只搜索从 `20` 开头到 `日` 结束的连续 `<w:t>` 序列，且对起始片段的匹配模式为 `/^20\d?X?$/`，无法匹配 `202X年6月17日` 中 `202X` 这种包含X但月份已确定的格式。`replaceDatePlaceholders` 的静态正则 `20\dX年X月XX日` 也无法匹配 `202X年6月17日`。

**修复方式**：

1. **扩展 `replaceDatePlaceholders` 正则以匹配部分占位符日期**：

- 新增模式 `/20\dX年\d{1,2}月\d{1,2}日/g` — 年份含X但月日已确定的格式（如 `202X年6月17日`）
- 保留原有 `20\dX年X月XX日` 和 `20XX年XX月XX日` 模式

2. **修复 `replaceMultiRunDate` 的起始匹配逻辑**：

- 将起始片段的匹配从 `/^20\d?X?$/` 放宽为匹配含 `20` 且含 `X` 或为纯日期数字的任何片段
- 在验证阶段允许部分确定日期的格式（`20[X\d]{2,4}` 开头到 `日` 结束）

3. **确保签名行锚点检测覆盖"检查："**：验证 `fillSignatureRowDirect` 中 `/检查[：:]/` 正则能正确匹配(1-1)表格中的"检查："锚点（当前已覆盖，但需验证多run拆分场景）