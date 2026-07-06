---
name: fix-column-table-filling
overview: 修复列类型（键值对）表格填充的三个核心 bug：多文本单元格标签匹配失败、空单元格全局替换错位、签名行日期未填充，并增加 fillRowWithData 的精确替换逻辑。
todos:
  - id: fix-multi-run-text
    content: 新增 getAllWtText，修改 getFirstWtText 和 extractCellTexts 支持多run单元格文本拼接
    status: completed
  - id: fix-replace-position
    content: 修复 fillKeyValueRow 全局 replace 错位：改用基于索引的精确位置替换
    status: completed
  - id: fix-signature-table
    content: 修复表格内签名行人名+日期：expandSignatureRow 按角色展开多列填入
    status: completed
    dependencies:
      - fix-multi-run-text
  - id: fix-signature-paragraph
    content: 修复段落签名锚点回退：filler.service.ts 增加"检测："兜底锚点
    status: completed
  - id: verify-compile
    content: 编译验证，确保零 TypeScript 错误
    status: completed
    dependencies:
      - fix-multi-run-text
      - fix-replace-position
      - fix-signature-table
      - fix-signature-paragraph
---

## 用户问题

列类型表格（键值对表格）数据填充存在三类错误：

1. **空行未填数据**：很多表格只插入了空行，没有填入实际数据
2. **列合并异常**：有些表格插入的行中，部分列被错误合并
3. **签名行未填充**：检测、校对人员和日期没有正确填入

## 根因分析

### Bug 1: 多run单元格文本提取不完整（`getFirstWtText`）

Word XML 中一个 `<w:tc>` 单元格可能包含多个 `<w:r>`（run），每个 run 有独立的 `<w:t>`。例如标签 "管道名称" 可能被拆成 `<w:t>管道</w:t>` 和 `<w:t>名称</w:t>`。当前 `getFirstWtText` 只用正则 `/<w:t\b[^>]*>(.*?)<\/w:t>/` 提取第一个 `<w:t>` 的文本，得到 "管道" 而非 "管道名称"，无法匹配源数据 Map 中的完整 Key，导致值单元格空着不填。

### Bug 2: `fillKeyValueRow` 全局 replace 导致填充错位

`resultXml = resultXml.replace(valueTc.content, newTc)` 使用 `String.replace` 全局替换。当一行有多个结构完全相同的空 `<w:tc>` 时（Word 生成的空单元格 XML 常完全一致），`replace` 只替换第一个匹配项，后续相同内容的空单元格无法被替换。这导致部分列合并/错位。

### Bug 3: `extractCellTexts` 同样只取第一个 `<w:t>`

源文档单元格也可能有多 run，导致提取的源数据列文本不完整，进而填充时列数据错位。

### Bug 4: 签名行日期和人名均未填充

签名行未填充有两个独立原因：

**4a. 表格内签名行**：`fillTableFromSource` → `fillRowWithData` 处理。但源文档签名行中"检测：张三 2025年6月23日"可能是**同一个 `<w:tc>` 内的完整文本**，而模板签名行将"检测："标签、人名、日期分开在不同 `<w:tc>` 中。`extractCellTexts` 又只取第一个 `<w:t>` 文本（Bug 3），导致提取到的 `signatureRow` 列数据不完整，`fillRowWithData` 填入时数据错位或丢失。

**4b. 段落签名行**：`insertTextAfterAnchor` 处理。但 `sigAnchor`（如 `（3-1）`）是从**源文档**提取的章节编号。如果模板中没有完全匹配的锚点文本，`insertTextAfterAnchor` 会打印 warning 并静默返回原 XML，签名人名永远不会被插入。

## 修改策略

### 修改文件

`server/src/services/xml-subtree-inserter.service.ts` — 所有4个Bug的修复集中在此文件。

### Bug 1 & Bug 3 修复：新增 `getAllWtText` 方法，替换 `getFirstWtText` 和 `extractCellTexts` 中的单run提取

新增方法：

```typescript
/** 提取 XML 片段中所有 <w:t> 文本的拼接值（处理多run单元格） */
private getAllWtText(xml: string): string {
  const texts: string[] = [];
  const regex = /<w:t\b[^>]*>(.*?)<\/w:t>/g;
  let m: RegExpExecArray | null;
  while ((m = regex.exec(xml)) !== null) {
    const t = m[1].trim();
    if (t) texts.push(t);
  }
  return texts.join("");
}
```

修改调用点：

1. `getFirstWtText` → 改用 `getAllWtText`（`fillKeyValueRow` 第369行和第377行）
2. `extractCellTexts` 第172行 → 改用 `getAllWtText` 拼接
3. `getFirstWtText` 方法可保留或删除（不再使用）

### Bug 2 修复：`fillKeyValueRow` 使用精确索引替换

当前代码（第384-389行）：

```typescript
const newTc = valueTc.content.replace(...);
resultXml = resultXml.replace(valueTc.content, newTc);  // BUG：全局替换
```

修复为：

```typescript
const newTc = valueTc.content.replace(
  /(<w:t\b[^>]*>)(.*?)(<\/w:t>)/,
  "$1" + this.escapeXml(sourceValue) + "$3"
);
// 使用 tcMatches[i+1].index 做精确位置替换
resultXml =
  resultXml.substring(0, valueTc.index) +
  newTc +
  resultXml.substring(valueTc.index + valueTc.content.length);
```

注意：`tcMatches` 数组中需要保存每个 `<w:tc>` 在原 `rowXml` 中的**绝对起始索引**。当前代码 `tcMatches` 的 `index` 已经是在 `rowXml` 中的绝对位置（第359行 `tcMatch.index`），可以直接使用。

### Bug 4a 修复：表格内签名行 — 签名文本按列展开填入

当前 `extractTableDataRows` 返回的 `signatureRow` 是 `string[]`，但源文档签名行中"检测：张三 2025年6月23日"可能全部在第一个 `<w:tc>` 中（只有一个元素）。模板签名行有多个 `<w:tc>`（如：`检测` | `日期` | `校对` | `日期`）。

**修复方案**：将源签名行的**所有单元格文本拼接**为一个完整字符串，然后用正则从中提取各角色的人名和日期，按模板签名行列结构组装数据填入。

```typescript
// 将源签名行所有单元格文本拼接
const sigFullText = signatureRow.join("");
// 从完整文本中提取各角色信息
const inspectorName = /检测[：:]\s*(.+?)(?:\s*\d{4}年|$)/.exec(sigFullText)?.[1]?.trim() || "";
const checkerName = /校对[：:]\s*(.+?)(?:\s*\d{4}年|$)/.exec(sigFullText)?.[1]?.trim() || "";
const inspectorDate = /检测[：:].*?(\d{4}年\d{1,2}月\d{1,2}日)/.exec(sigFullText)?.[1]?.trim() || "";
const checkerDate = /校对[：:].*?(\d{4}年\d{1,2}月\d{1,2}日)/.exec(sigFullText)?.[1]?.trim() || "";
// 按模板列结构组装：["检测：张三", "2025年6月23日", "校对：李四", "2025年6月24日"]
const expandedSigData = ["检测：" + inspectorName, inspectorDate, "校对：" + checkerName, checkerDate];
filledSignatureRow = this.fillRowWithData(signatureTemplate, expandedSigData);
```

同时，签名行填充后需清除模板中未被替换的日期占位符（`202X年X月XX日`、`20XX年XX月XX日`）。

### Bug 4b 修复：段落签名行 — 放宽锚点匹配

`insertTextAfterAnchor` 使用源文档章节编号 `（3-1）` 作为锚点，但模板中可能使用不同格式。改为按章节 ID 匹配，同时增加"检测："标签作为兜底锚点。

在 `filler.service.ts` 的 `fillBySubtreeCopy` 第186-196行，改为：

```typescript
if (chapter.signatureText) {
  // 尝试章节编号锚点
  let xml2 = xmlSubtreeInserter.insertTextAfterAnchor(xml, `（${chapter.id}）`, chapter.signatureText);
  if (xml2 === xml) {
    // 回退：直接搜索"检测："标签
    xml2 = xmlSubtreeInserter.insertTextAfterAnchor(xml, "检测：", chapter.signatureText);
  }
  if (xml2 !== xml) stats.paragraphsInserted++;
  xml = xml2;
}
```

### 完整修改清单

| 文件 | 方法/位置 | 修改内容 |
| --- | --- | --- |
| `xml-subtree-inserter.service.ts` | 新增 `getAllWtText` | 提取 XML 中所有 `<w:t>` 文本拼接 |
| `xml-subtree-inserter.service.ts` | `getFirstWtText` | 改为调用 `getAllWtText` |
| `xml-subtree-inserter.service.ts` | `extractCellTexts` 第172行 | 改为 `getAllWtText(tc)` |
| `xml-subtree-inserter.service.ts` | `fillKeyValueRow` 第369/377行 | 使用 `getAllWtText` 替代 `getFirstWtText` |
| `xml-subtree-inserter.service.ts` | `fillKeyValueRow` 第384-389行 | 精确索引替换替代全局 `String.replace` |
| `xml-subtree-inserter.service.ts` | `fillTableFromSource` 第87-96行 | 签名行文本按列展开填入 + 日期占位符清除 |
| `xml-subtree-inserter.service.ts` | 新增 `expandSignatureRow` | 将源签名行单列文本按角色展开为多列数据 |
| `xml-subtree-inserter.service.ts` | 新增 `replaceDatePlaceholders` | 清除未替换的日期占位符 |
| `filler.service.ts` | `fillBySubtreeCopy` 第186-196行 | 段落签名锚点回退逻辑：章节编号 → "检测："标签 |


### 不变的部分

- `fillKeyValueTable` 入口逻辑不变
- `fillTableFromSource` 对外接口不变
- `fillRowWithData` 不变
- `extractTableDataRows` 签名行识别逻辑不变
- `getTableWrapper` 不变
- `filler.service.ts` 调用逻辑不变