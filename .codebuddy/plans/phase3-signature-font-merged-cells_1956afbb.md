---
name: phase3-signature-font-merged-cells
overview: 修复4个问题：(1)KV表签名行误识别为KV key；(2)所有签名行日期前空格删5字符避免换行；(3)填充文字字体一致性；(4)附页表gridSpan表头列数识别错误+非签名行被误判为签名行。涉及template-analyzer.service.ts和xml-subtree-inserter.service.ts两个文件。
todos:
  - id: fix-analyzer-signature-gridspan
    content: "修复 template-analyzer.service.ts: KV表签名行检测+排除签名行kvKeys; 列表表签名行验证; 表头gridSpan展开"
    status: completed
  - id: fix-inserter-spaces-font-sig
    content: "修复 xml-subtree-inserter.service.ts: trimSignatureSpaces空格清理; injectTextIntoCell字体改进; fillTableFromSource签名行验证"
    status: completed
    dependencies:
      - fix-analyzer-signature-gridspan
  - id: compile-restart
    content: 编译 TypeScript 并重启服务器
    status: completed
    dependencies:
      - fix-inserter-spaces-font-sig
  - id: e2e-verify
    content: "用 [subagent:code-explorer] 端到端验证 Table #2/#3 的类型识别、签名行填充、空格清理、字体一致性"
    status: completed
    dependencies:
      - compile-restart
---

## 用户需求

用户报告了4个表格处理问题，需要修复：

### 问题1：(1-1)原始资料审查报告 有签名行，格式识别不对

- Table #3 是KV表（17行），最后一行（Row 16）是签名行（含"检查："和"校对："），但KV表分支将`signaturePosition`设为`null`，导致签名行未被识别
- 签名行文本"检查：202X年6月17日"被误提取为KV key

### 问题2：所有表格签名行，填写完数据后，将日期前面的空格删掉5个字符，避免产生换行

- 签名行XML中存在大量空格（如32个空格的独立`<w:t>` run），插入姓名后内容超出单元格宽度产生换行
- 需要在填充后清理签名行中的多余空格

### 问题3：所有填充的文字字体保持一致

- 模板使用宋体 sz=18（9pt），部分填充路径可能未正确继承字体属性
- 需确保所有注入文本的`<w:r>`都带有正确的`<w:rPr>`字体属性

### 问题4：XXXXXX年度检查报告附页 表格格式识别不对

- Table #2 是横向列表表格（37行），表头Row 0有gridSpan=4的合并单元格（4物理格→7逻辑列）
- `getCellMergedTexts`不展开gridSpan，返回4列而非7列
- 最后一行（Row 36: "39","8安全保护装置检验"）是数据行而非签名行，但被无条件设为签名行

## 产品概述

修复KV表签名行检测、签名行空格清理、字体一致性、附页表格表头展开和签名行验证5个环节的缺陷，确保KV表的签名行能被正确识别和填充、签名行不因多余空格产生换行、所有填充文字字体与模板一致、附页表格的合并表头被正确展开。

## 核心功能

1. **KV表签名行检测**：KV表分支检测最后一行是否含签名关键词（检测/校对/审核/检查/审批），若含则设置signaturePosition并排除签名行文本从kvKeys
2. **签名行空格清理**：填充签名行后，移除仅含空格的独立`<w:r>` run，并削减`<w:t>`中的连续空格
3. **字体一致性**：`injectTextIntoCell`的case3改进rPr继承逻辑，确保无`<w:t>`的空单元格注入文本时使用正确字体
4. **附页表头gridSpan展开**：表头提取时展开gridSpan获取正确的逻辑列数，使列数与数据行匹配
5. **签名行验证**：列表表分支和`fillTableFromSource`中验证最后一行是否为签名行（含签名关键词），非签名行不作为签名模板

## 技术栈

- TypeScript (Node.js 后端, Express.js)
- Word XML 直接操作（docx unpack/pack 工具链）
- 无前端变更

## 根因分析

### 根因1：KV表签名行未检测（问题1）

**文件**: `template-analyzer.service.ts` 第201-238行
KV表分支无条件设置`signaturePosition: null`，且遍历所有行提取kvKeys时不排除签名行。Table #3 Row 16包含"检查：202X年6月17日"和"校对：202X年6月20日"，这些文本被提取为kvKey。

### 根因2：签名行空格导致换行（问题2）

**文件**: `xml-subtree-inserter.service.ts` 第197-213行
签名行填充后未清理空格。Table #3 Row 16的XML中：`<w:t>检查：   </w:t>`（3空格）后跟`<w:t xml:space="preserve">                                </w:t>`（32空格），插入姓名"张工"后总内容超出单元格宽度。

### 根因3：字体不一致风险（问题3）

**文件**: `xml-subtree-inserter.service.ts` 第438-452行
`injectTextIntoCell` case3（无`<w:t>`标签）使用`/<w:rPr(?:\s[^>]*)?>.*?<\/w:rPr>/s`提取rPr，该正则搜索整个cellXml，可能匹配到非`<w:pPr>`中的`<w:rPr>`。若无任何`<w:rPr>`则用空`<w:rPr/>`，丢失字体信息。

### 根因4：附页表头gridSpan未展开（问题4）

**文件**: `template-analyzer.service.ts` 第48-53行
`getCellMergedTexts(firstTr)`返回物理单元格数（4格），不展开gridSpan。Table #2表头Row 0有gridSpan=[1,4,1,1]=7逻辑列，但返回4列。数据行有6物理格=7逻辑列，列数不匹配。

### 根因5：列表表签名行未验证（问题4）

**文件**: `template-analyzer.service.ts` 第269-287行 + `xml-subtree-inserter.service.ts` 第127行
列表表分支无条件提取最后一行作为签名行。`fillTableFromSource`也无条件将最后一行作为`signatureTemplate`。Table #2最后一行Row 36是数据行（"39","8安全保护装置检验"），不含签名关键词。

## 实现方案

### 修复1：KV表签名行检测

**文件**: `template-analyzer.service.ts` 第201-238行

在KV表分支中，提取kvKeys后检测最后一行是否为签名行：

- 获取最后一行文本，检测是否含签名关键词（`/检测[：:]|校对[：:]|审核[：:]|检查[：:]|审批[：:]/`）
- 若为签名行：设置`signaturePosition: { tableIndex: tblIdx }`，设置`signatureFields`，并从kvKeys中过滤掉签名行文本
- 若非签名行：保持`signaturePosition: null`（与现有行为一致）

```typescript
// 检测KV表最后一行是否为签名行
const lastKvRowCells = allTrMatches.length > 0
  ? getCellMergedTexts(allTrMatches[allTrMatches.length - 1].content)
  : [];
const lastKvRowText = lastKvRowCells.join("");
const kvHasSignature = /检测[：:]|校对[：:]|审核[：:]|检查[：:]|审批[：:]/.test(lastKvRowText);

// 从kvKeys中排除签名行文本
const sigTexts = kvHasSignature ? new Set(lastKvRowCells.filter(t => t && t.length < 50)) : new Set<string>();
const filteredKeys = uniqueKeys.filter(k => !sigTexts.has(k));

sections.push({
  sectionId: encodedSectionId,
  placeholderFields: [],
  tables: [{ tableIndex: tblIdx, isKeyValue: true, kvKeys: filteredKeys, columns: [] }],
  signaturePosition: kvHasSignature ? { tableIndex: tblIdx } : null,
  signatureFields: kvHasSignature ? lastKvRowCells.filter(t => t && t.length < 30) : undefined,
});
```

### 修复2：签名行空格清理

**文件**: `xml-subtree-inserter.service.ts` 第213行后

新增`trimSignatureSpaces`方法，在`replaceDatePlaceholders`之后调用：

- 移除仅含空格的独立`<w:r>` run（`<w:r>...<w:t xml:space="preserve">   </w:t>...</w:r>`）
- 削减`<w:t>`内连续空格至最多1个

```typescript
private trimSignatureSpaces(xml: string): string {
  // 1. 移除仅含空格的独立 <w:r> run
  let result = xml.replace(
    /<w:r\b[^>]*>(?:\s*<w:rPr\b[^>]*>[\s\S]*?<\/w:rPr>)?\s*<w:t\s+xml:space="preserve">\s+<\/w:t>\s*<\/w:r>/g,
    ""
  );
  // 2. 削减 <w:t> 内连续空格至最多1个（保留文本内容）
  result = result.replace(
    /(<w:t\b[^>]*>)([^<]*\s{2,}[^<]*)(<\/w:t>)/g,
    (_match, tag, text, close) => tag + text.replace(/\s{2,}/g, " ") + close
  );
  return result;
}
```

在`fillTableFromSource`的第213行后添加调用：

```typescript
filledSignatureRow = this.replaceDatePlaceholders(filledSignatureRow);
filledSignatureRow = this.trimSignatureSpaces(filledSignatureRow); // 新增
```

### 修复3：字体一致性

**文件**: `xml-subtree-inserter.service.ts` 第438-452行

改进`injectTextIntoCell` case3的rPr提取逻辑：

- 优先从`<w:pPr>`内的`<w:rPr>`提取（段落级默认字体）
- 若无，从cell内任意`<w:rPr>`提取
- 若仍无，使用默认宋体rPr

```typescript
// 优先从 <w:pPr><w:rPr> 提取段落默认字体
const pPrRprMatch = /<w:pPr\b[^>]*>[\s\S]*?(<w:rPr\b[^>]*>[\s\S]*?<\/w:rPr>)[\s\S]*?<\/w:pPr>/.exec(cellXml);
const anyRprMatch = /<w:rPr\b[^>]*>[\s\S]*?<\/w:rPr>/.exec(cellXml);
const inheritedRPr = pPrRprMatch?.[1] || anyRprMatch?.[0] || '<w:rPr><w:rFonts w:ascii="宋体" w:hAnsi="宋体" w:eastAsia="宋体" w:cs="宋体"/><w:sz w:val="18"/><w:szCs w:val="18"/></w:rPr>';
```

### 修复4：附页表头gridSpan展开

**文件**: `template-analyzer.service.ts` 第48-53行

在表头提取时展开gridSpan获取逻辑列数：

- 新增内联逻辑：遍历首行`<w:tc>`，累加gridSpan值得到逻辑列数
- 展开headers数组：对gridSpan>1的单元格，重复其文本gridSpan次
- 过滤空文本后得到正确的列名列表

```typescript
if (trMatch) {
  const firstTr = extractTagContent(tbl, trMatch.index, "w:tr");
  if (firstTr) {
    // 展开 gridSpan 获取逻辑列
    const expandedHeaders: string[] = [];
    const tcRe = /<w:tc[ >]/g;
    let tcM;
    while ((tcM = tcRe.exec(firstTr)) !== null) {
      const tcContent = extractTagContent(firstTr, tcM.index, "w:tc");
      if (!tcContent) continue;
      const gsMatch = /<w:gridSpan\s+w:val="(\d+)"/.exec(tcContent);
      const span = gsMatch ? parseInt(gsMatch[1], 10) : 1;
      // 提取单元格文本
      const wtRe = /<w:t\b[^>]*>(.*?)<\/w:t>/gs;
      const parts: string[] = [];
      let wtM;
      while ((wtM = wtRe.exec(tcContent)) !== null) {
        const t = wtM[1].trim();
        if (t && !t.startsWith("<")) parts.push(t);
      }
      const text = parts.join("");
      for (let s = 0; s < span; s++) {
        expandedHeaders.push(s === 0 ? text : (text ? "" : ""));
      }
    }
    headers = expandedHeaders.filter(t => t && t.length < 50);
  }
}
```

注意：展开后的headers会包含空字符串（gridSpan覆盖的列），这些会被`filter(t => t && t.length < 50)`过滤掉。但列数信息通过`columns`数组长度传递。对于附页表，展开后headers=["序号","检查项目及其内容","","","","检查结果","备注"]，过滤后=["序号","检查项目及其内容","检查结果","备注"]（4个），但columns数组会基于展开前的headers构建。

实际上，为了保持列数正确，应该保留展开后的数组（含空字符串），让`fillRowWithData`的`logicalToPhysical`映射能正确工作。修改为：

```typescript
headers = expandedHeaders; // 保留空字符串，不过滤
// 后续 columns 构建时用 headers.map(h => ({ header: h || `列${i+1}`, mappedField: h || `列${i+1}` }))
```

### 修复5：签名行验证

**文件**: `template-analyzer.service.ts` 第269-287行 + `xml-subtree-inserter.service.ts` 第127行

#### 5a. 列表表分支签名行验证

在列表表分支中，提取最后一行文本后检查是否含签名关键词：

```typescript
const lastRowText = sigLabels.join("");
const hasSignature = /检测[：:]|校对[：:]|审核[：:]|检查[：:]|审批[：:]/.test(lastRowText);
// 仅当含签名关键词时设置 signaturePosition
signaturePosition: hasSignature ? { tableIndex: tblIdx } : null,
signatureFields: hasSignature && sigLabels.length > 0 ? sigLabels : undefined,
```

#### 5b. fillTableFromSource 签名行验证

在`fillTableFromSource`中，验证最后一行是否为签名行：

```typescript
// 验证最后一行是否为签名行
const lastRowText = getCellMergedTexts(signatureTemplate).join("");
const isSignatureRow = /检测[：:]|校对[：:]|审核[：:]|检查[：:]|审批[：:]/.test(lastRowText);

if (isSignatureRow) {
  // 现有逻辑：签名行模板 + 数据行（排除最后一行）
  templateDataRows = targetRows.slice(headerEndIndex, targetRows.length - 1);
  // ... 填充签名行 ...
} else {
  // 最后一行不是签名行：全部作为数据行，无签名行填充
  templateDataRows = targetRows.slice(headerEndIndex, targetRows.length);
  // 组装时不添加 filledSignatureRow
}
```

## 实现要点

### 性能分析

- KV签名行检测：仅检查最后一行文本，O(1)
- 签名行空格清理：仅在签名行（每表1行）上执行正则替换，O(n) n=签名行XML长度
- 字体rPr提取：仅在case3（无`<w:t>`的空单元格）触发，O(n) n=单元格XML长度
- 表头gridSpan展开：仅遍历首行单元格，O(m) m=列数
- 签名行验证：`getCellMergedTexts`已在现有代码中调用，复用结果

### 爆炸半径控制

- KV签名行检测：仅在KV表分支新增局部判断，不影响列表表/Hybrid表
- 签名行空格清理：在`replaceDatePlaceholders`后新增一步，不影响其他填充逻辑
- 字体rPr提取：仅在case3改进，case1/case2行为不变
- 表头gridSpan展开：仅在headers提取处修改，无gridSpan的表头行为不变（span=1）
- 签名行验证：非签名行表格不设signaturePosition，fillTableFromSource将最后一行作为数据行

### 日志策略

- KV签名行检测：`logger.info`输出检测结果
- 签名行空格清理：`logger.info`输出清理的空格数
- 签名行验证：`logger.info`输出最后一行是否为签名行

## 目录结构

```
server/src/
├── services/
│   ├── template-analyzer.service.ts    # [MODIFY] KV签名行检测; 列表签名行验证; 表头gridSpan展开
│   ├── xml-subtree-inserter.service.ts # [MODIFY] trimSignatureSpaces; injectTextIntoCell字体; fillTableFromSource签名验证
│   └── filler.service.ts               # [不修改] fillBySubtreeCopyV2 通过 section.signaturePosition 自动适配
└── utils/
    └── xml-utils.ts                    # [不修改]
```

## 修改文件清单

| 文件 | 修改点 | 行号 |
| --- | --- | --- |
| `template-analyzer.service.ts` | 表头提取展开gridSpan | 48-53 |
| `template-analyzer.service.ts` | KV表签名行检测+排除签名行kvKeys | 201-238 |
| `template-analyzer.service.ts` | 列表表签名行验证（仅含关键词时设signaturePosition） | 269-287 |
| `xml-subtree-inserter.service.ts` | 新增`trimSignatureSpaces`方法+调用 | 213后 |
| `xml-subtree-inserter.service.ts` | `injectTextIntoCell` case3 rPr提取改进 | 438-442 |
| `xml-subtree-inserter.service.ts` | `fillTableFromSource` 签名行验证 | 127-224 |


## Agent Extensions

### SubAgent

- **code-explorer**
- Purpose: 编译修复后端到端验证 Table #3（KV签名行检测+空格清理）、Table #2（附页表头展开+签名行验证）的类型识别、样例数据、填充结果
- Expected outcome: Table #3 正确检测签名行并设置signaturePosition，签名行姓名正确插入且无多余空格换行，字体一致；Table #2 表头展开为7逻辑列，最后一行数据行不被误判为签名行