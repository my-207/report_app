---
name: fix-v5-table-issues
overview: 修复3个表格填充问题：(1)Table#8被误判为混合表+数据行模板gridSpan=6导致合并+签名行姓名未插入(检测/：分run)；(2)Table#26第二数据行模板gridSpan=6导致合并；(3)Table#27标题识别为子标题而非附页标题。
todos:
  - id: fix-hybrid-list-exclusion
    content: "修复 template-analyzer.service.ts: Hybrid检测增加 row0IsKvRow 判据（偶数位非数字/斜杠/列表关键词）+ 标题提取两遍扫描优先附页/附图"
    status: pending
  - id: fix-merged-row-template
    content: "修复 xml-subtree-inserter.service.ts: fillTableFromSource 过滤 gridSpan 全列合并行作为数据行模板"
    status: pending
    dependencies:
      - fix-hybrid-list-exclusion
  - id: fix-signature-cross-run
    content: "修复 xml-subtree-inserter.service.ts: fillSignatureRowDirect 增加跨run锚点策略2 + replaceDatePlaceholders 增加多run日期替换"
    status: pending
    dependencies:
      - fix-merged-row-template
  - id: compile-restart
    content: 编译 TypeScript 并重启服务器
    status: pending
    dependencies:
      - fix-signature-cross-run
  - id: e2e-verify
    content: "用 [subagent:code-explorer] 端到端验证 Table #8/#26/#27 的类型识别、样例数据、填充结果"
    status: pending
    dependencies:
      - compile-restart
---

## 用户需求

用户报告了3个表格处理问题，需要修复：

### 问题1：(2-1)管道位置与走向检查报告（Table #8）

- 表格类型识别错误：应为列表型表格，但被误判为混合表（Hybrid），导致表头行（序号/起点位置等）被提取为KV对，样例数据结构错误
- 签名行问题：插入人名后导致单元格换行；日期占位符"202X年X月XX日"未被替换

### 问题2：(6-1)壁厚测定报告（Table #26）

- 第二组数据写入错误：源数据有6列值，但模板第二行数据行只有1个gridSpan=6的合并单元格，导致6列数据全部写入同一个单元格，产生错误合并

### 问题3：XXXXXX年度检查报告附页（Table #27）

- 表格标题识别错误：实际标题应为"XXXXXX年度检查报告附页"，但被识别为"（7-1）地址条件调查报告"
- 标题提取函数从最后段落往回搜索时，优先匹配了子标题而非主标题

## 产品概述

修复表格类型检测、数据行模板选择、签名行姓名插入、日期占位符替换、标题提取5个环节的缺陷，确保列表型表格不被误判为混合表、合并行不作为数据行模板、跨run的锚点能正确插入姓名、拆分run的日期能被替换、附页标题能被正确识别。

## 核心功能

1. **Hybrid检测增加列表表排除判据**：Row0的偶数位必须是有效KV标签（非数字、非"/"、非列表数据值），避免列表表Row0+Row1被误判为混合表
2. **合并行模板跳过**：gridSpan覆盖全列的行（单元格数远少于表头列数）不是有效数据行模板，应跳过或用第一个有效数据行替代
3. **跨run锚点姓名插入**：当"检测"和"："在不同`<w:r><w:t>`中时，增加跨run匹配策略
4. **多run日期占位符清除**：`replaceDatePlaceholders`增加对拆分到多个`<w:t>`中的日期占位符的替换
5. **标题提取优先"附页/附图"关键词**：在括号编号匹配之前，优先匹配含"附页""附图"的段落

## 技术栈

- TypeScript (Node.js 后端, Express.js)
- Word XML 直接操作（docx unpack/pack 工具链）
- 无前端变更

## 根因分析

### 根因1：Hybrid检测误判列表表（问题1）

**文件**: `server/src/services/template-analyzer.service.ts` 第126-127行

`countKvPairsInRow` 在上一轮修复中放宽为"不检查值非空"，导致列表表Row0（["序号","起点位置","终点位置","最浅埋深（m）","长度（m）","描述"]）的偶数位全部计为KV标签（3对≥2）。同时Row1（["1","/","/","/","/","无浅埋点"]）过滤后有6格≥3。三个条件全满足 → 误判为Hybrid。

**根因**: `countKvPairsInRow` 对列表表头也返回高分，因为列表表头的偶数位恰好都是文字标签。需要增加"Row0是KV行"的判据：偶数位标签不能是纯数字、不能是"/"、不能是列表数据值。

### 根因2：合并行作为数据行模板（问题1+2）

**文件**: `server/src/services/xml-subtree-inserter.service.ts` 第130行、第150-164行

Table#8 Row2/Row3 和 Table#26 Row3 只有1个gridSpan=6的合并单元格。这些是模板的"空白占位行"。`templateDataRows = targetRows.slice(headerEndIndex, targetRows.length - 1)` 将它们包含在数据行模板中。`fillRowWithData`的`logicalToPhysical`映射将所有6个逻辑列映射到同一个物理单元格 → 6列数据全写入1格。

**根因**: 未过滤gridSpan全列合并行。当模板数据行的单元格数远少于表头列数（如1格 vs 6格），该行不是有效数据行模板。

### 根因3：跨run锚点姓名插入失败（问题1）

**文件**: `server/src/services/xml-subtree-inserter.service.ts` 第680行

Table#8 Cell0的XML结构：`<w:t>检测</w:t><w:t>：</w:t>` — "检测"和"："在不同run中。正则`(<w:t\b[^>]*>)([^<]*${escaped})`要求"检测："在同一个`<w:t>`内 → 不匹配 → 姓名未插入。

### 根因4：多run日期占位符未替换（问题1）

**文件**: `server/src/services/xml-subtree-inserter.service.ts` 第624-628行

Table#8 Cell2的日期"202X年X月XX日"被拆分到7个`<w:t>`：`<w:t>202</w:t><w:t>X</w:t><w:t>年</w:t>...`。`replaceDatePlaceholders`只用简单正则`20\dX年X月XX日`匹配单run文本 → 不匹配。

Cell2没有角色关键词（检测/校对/审核），`fillSignatureRowDirect`跳过它。`replaceDatePlaceholders`也无法匹配拆分run的日期。

### 根因5：附页标题被子标题覆盖（问题3）

**文件**: `server/src/services/template-analyzer.service.ts` 第534-548行

`extractTableTitleFromParagraphs`从最后一个段落往回找，第一个匹配的是"（7-1）地址条件调查报告"（括号编号模式）。"XXXXXX年度检查报告附页"在更早的段落中，但不匹配任何现有规则（以X开头，不匹配括号/表N-N/中文结尾关键词模式）。

## 实现方案

### 修复1：Hybrid检测增加列表表排除判据

**文件**: `server/src/services/template-analyzer.service.ts` 第126-127行

在现有条件基础上，增加Row0是否为真正KV行的判断：Row0偶数位标签不能是列表表头特征值（纯数字、"/"、列表关键词）。

```typescript
// 修改后: 增加Row0 KV行验证
const kvPairCount = countKvPairsInRow(row0RawCells);
// 新增: 验证Row0是否为真正的KV行（偶数位不能是纯数字/斜杠/列表关键词）
const LIST_KW_SET = new Set(['序号','编号','检验项目','检查项目','检查内容','检查结果','页码','附图','备注','日期','检测结果','处理措施','事件类型','位置','深度','壁厚','规格型号']);
const row0IsKvRow = (() => {
  let validLabels = 0;
  for (let i = 0; i < row0RawCells.length - 1; i += 2) {
    const label = row0RawCells[i];
    if (!label || !label.trim()) return false; // KV行标签不能为空
    if (/^\d+$/.test(label.trim())) return false; // 纯数字不是KV标签
    if (label.trim() === '/') return false; // 斜杠不是KV标签
    if (LIST_KW_SET.has(label.trim())) return false; // 列表关键词不是KV标签
    validLabels++;
  }
  return validLabels >= 2; // 至少2个有效标签
})();

if (row0RawCells.length >= 4 && row1Cells.length >= 3 && kvPairCount >= 2 && row0IsKvRow) {
```

Table#8 Row0 = ["序号","起点位置",...] → "序号"命中LIST_KW_SET → `row0IsKvRow=false` → 不判为Hybrid → 正确判为列表型。
Table#16 Row0 = ["设备名称","","管道规格","","环境条件",""] → "设备名称"非数字/斜杠/列表词 → 有效 → `row0IsKvRow=true` → 正确判为Hybrid。

### 修复2：跳过gridSpan全列合并行作为数据行模板

**文件**: `server/src/services/xml-subtree-inserter.service.ts` 第129-130行

在提取`templateDataRows`后，过滤掉gridSpan覆盖全列的合并行。如果过滤后无可用模板行，用第一个有效数据行（单元格数≥表头列数一半的行）作为模板。

```typescript
// 修改后: 过滤合并行
let templateDataRows = targetRows.slice(headerEndIndex, targetRows.length - 1);

// 计算表头列数（逻辑列数）
const headerLogicalCols = headerRows.length > 0
  ? (() => {
      const firstHeader = headerRows[0];
      let cols = 0;
      const tcRe = /<w:tc[ >]/g;
      let htc;
      while ((htc = tcRe.exec(firstHeader)) !== null) {
        const htcContent = extractTagContent(firstHeader, htc.index, "w:tc");
        if (!htcContent) continue;
        const gsMatch = /<w:gridSpan\s+w:val="(\d+)"/.exec(htcContent);
        cols += gsMatch ? parseInt(gsMatch[1], 10) : 1;
      }
      return cols;
    })()
  : 0;

// 过滤: 单元格数 < 表头逻辑列数一半 的行是合并占位行，不是有效数据行模板
if (headerLogicalCols > 0) {
  const validTemplateRows = templateDataRows.filter(row => {
    const cellCount = (row.xml.match(/<w:tc[ >]/g) || []).length;
    return cellCount >= Math.ceil(headerLogicalCols / 2);
  });
  if (validTemplateRows.length > 0) {
    templateDataRows = validTemplateRows;
  }
}
```

Table#8: 表头逻辑列数=6，templateDataRows=[Row1(6格), Row2(1格), Row3(1格)] → 过滤后=[Row1(6格)] → 源数据2行都用Row1模板 → 正确。
Table#26: 表头逻辑列数=6，templateDataRows=[Row2(6格), Row3(1格)] → 过滤后=[Row2(6格)] → 源数据2行都用Row2模板 → 正确。

### 修复3：fillSignatureRowDirect 增加跨run锚点匹配

**文件**: `server/src/services/xml-subtree-inserter.service.ts` 第676-685行

在策略1（同一`<w:t>`内匹配）失败后，增加策略2：跨相邻`<w:t>`匹配。检测"检测"在一个`<w:t>`中、"："在紧接的下一个`<w:t>`中的情况，在"："所在`<w:t>`的文本后插入姓名。

```typescript
if (role.name && role.name.trim()) {
  for (const anchor of role.anchors) {
    const escaped = anchor.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    // 策略1: 锚点在单个 <w:t> 内
    const re1 = new RegExp(`(<w:t\\b[^>]*>)([^<]*${escaped})`);
    if (re1.test(newTc)) {
      newTc = newTc.replace(re1, `$1$2${role.name}`);
      break;
    }
    // 策略2: 锚点跨相邻 <w:t>（如"检测"在一个run，"："在下一个run）
    // 匹配: <w:t>检测</w:t>...</w:r><w:r...><w:t>：</w:t> → 在"："的<w:t>后插入姓名
    const parts = anchor.split(/([：:])/);
    if (parts.length === 2) {
      const labelPart = parts[0]; // "检测"
      const colonPart = parts[1]; // "：" 或 ":"
      const escapedLabel = labelPart.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const escapedColon = colonPart.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const re2 = new RegExp(
        `(<w:t\\b[^>]*>${escapedLabel}</w:t>)([\\s\\S]*?<w:t\\b[^>]*>)${escapedColon}(<\\/w:t>)`
      );
      if (re2.test(newTc)) {
        newTc = newTc.replace(re2, `$1$2${escapedColon}${role.name}$3`);
        break;
      }
    }
  }
}
```

Table#8 Cell0: `<w:t>检测</w:t>...<w:t>：</w:t>` → 策略2匹配 → 在"："后插入姓名 → "检测：张工"。

### 修复4：replaceDatePlaceholders 增加多run日期替换

**文件**: `server/src/services/xml-subtree-inserter.service.ts` 第624-628行

在现有单run正则基础上，增加对拆分到多个`<w:t>`中的日期占位符的替换。复用`replaceMultiRunDate`的逻辑，但用于清除（替换为空或实际日期）。

```typescript
private replaceDatePlaceholders(xml: string): string {
  // 策略1: 单run日期占位符
  let result = xml
    .replace(/20\dX年X月XX日/g, "")
    .replace(/20XX年XX月XX日/g, "");

  // 策略2: 多run日期占位符（如 <w:t>202</w:t><w:t>X</w:t><w:t>年</w:t>...）
  // 匹配从 <w:t>20 到 <w:t>日</w:t> 的连续 run 序列
  const multiRunDateRegex = /<w:t\b[^>]*>20<\/w:t>(?:\s*<\/w:r>\s*<w:r\b[^>]*>\s*)?<w:t\b[^>]*>[^<]*<\/w:t>(?:\s*<\/w:r>\s*<w:r\b[^>]*>\s*)?<w:t\b[^>]*>年<\/w:t>[\s\S]*?<w:t\b[^>]*>日<\/w:t>/g;
  result = result.replace(multiRunDateRegex, (match) => {
    // 验证是否为日期占位符（中间只含数字/X/年/月/日）
    const texts = [...match.matchAll(/<w:t\b[^>]*>([^<]*)<\/w:t>/g)].map(m => m[1]);
    const fullText = texts.join('');
    if (/^20[X\d]*年[X\d]+月[X\d]+日$/.test(fullText)) {
      return ''; // 清除占位符
    }
    return match;
  });

  return result;
}
```

Table#8 Cell2: `<w:t>202</w:t><w:t>X</w:t><w:t>年</w:t><w:t>X</w:t><w:t>月</w:t><w:t>XX</w:t><w:t>日</w:t>` → 匹配 → 替换为空。

注意：`replaceMultiRunDate`在`fillSignatureRowDirect`中已经处理了有角色关键词的单元格的日期替换。此修复4针对的是没有角色关键词但包含日期占位符的单元格（如Table#8 Cell2 "202X年X月XX日"独立单元格），这些单元格在`fillSignatureRowDirect`中被跳过，仅靠`replaceDatePlaceholders`处理。

### 修复5：标题提取优先"附页/附图"关键词

**文件**: `server/src/services/template-analyzer.service.ts` 第534-548行

在现有匹配规则之前（即在括号编号匹配之前），增加"附页""附图"关键词的优先匹配。

```typescript
for (let i = texts.length - 1; i >= 0; i--) {
  const text = texts[i];
  // 优先匹配: 含"附页""附图"关键词的标题（如"XXXXXX年度检查报告附页"）
  if (/附页|附图/.test(text) && text.length >= 5) {
    return text;
  }
  // 匹配中文括号章节编号: （3-1）... 或 （三）...
  if (/^[（(][\d一二三四五六七八九十]+[)\）\-—][^）)]/.test(text) && text.length >= 5) {
    return text;
  }
  // ... 其余不变
}
```

Table#27: 段落从后往回找 → 先检查"（7-1）地址条件调查报告" → 不含附页/附图 → 继续往回 → "7  地质条件调查报告" → 不含 → 继续往回 → "XXXXXX年度检查报告附页" → 含"附页" → 返回。

等等，这个逻辑有问题。"XXXXXX年度检查报告附页"在更早的段落，而"（7-1）"在更晚的段落。从后往回找时，先遇到"（7-1）"，如果先检查附页规则会跳过"（7-1）"继续往回找。但如果"（7-1）"在"附页"之后，那就需要先找到"附页"。

实际上问题是："附页"段落和"（7-1）"段落都在表格前面，"附页"在更前面。从后往回找时，先遇到"（7-1）"。如果"附页"优先级更高，应该在遇到"（7-1）"时不是立即返回，而是继续检查有没有"附页"。

更好的策略：**两遍扫描**。第一遍找"附页/附图"，第二遍找括号编号。如果第一遍找到，直接返回。

```typescript
// 第一遍: 优先查找"附页/附图"标题
for (let i = texts.length - 1; i >= 0; i--) {
  if (/附页|附图/.test(texts[i]) && texts[i].length >= 5) {
    return texts[i];
  }
}
// 第二遍: 查找括号编号标题
for (let i = texts.length - 1; i >= 0; i--) {
  // ... 现有逻辑
}
```

## 实现要点

### 性能分析

- Hybrid检测新增的`row0IsKvRow`检查仅遍历Row0的格数（通常4-8），O(n)常数级
- 合并行过滤在提取templateDataRows后执行一次，O(m)（m为数据行数，通常2-5）
- 跨run锚点匹配和日期替换仅在签名行单元格上执行（每表1-3个单元格），无性能影响
- 标题提取两遍扫描，texts数组通常3-5个元素，无影响

### 爆炸半径控制

- `row0IsKvRow`是Hybrid检测内部新增的局部判断，不影响其他路径
- 合并行过滤在`fillTableFromSource`内，不影响函数签名
- 跨run锚点策略2在策略1失败后执行，策略1命中的表格行为不变
- `replaceDatePlaceholders`新增策略2在策略1后执行，单run日期行为不变
- 标题提取两遍扫描，第一遍无命中时第二遍行为与原来完全一致

### 日志策略

- Hybrid检测新增`row0IsKvRow`判定结果输出`logger.info`
- 合并行过滤输出`logger.info`（含过滤前后行数）
- 跨run锚点命中时输出`logger.info`

## 目录结构

```
server/src/
├── services/
│   ├── template-analyzer.service.ts    # [MODIFY] Hybrid检测: 增加row0IsKvRow判据; 标题提取: 两遍扫描优先附页/附图
│   └── xml-subtree-inserter.service.ts # [MODIFY] fillTableFromSource: 过滤合并行模板; fillSignatureRowDirect: 跨run锚点策略2; replaceDatePlaceholders: 多run日期替换
└── utils/
    └── xml-utils.ts                    # [不修改]
```

## 修改文件清单

| 文件 | 修改点 | 行号 |
| --- | --- | --- |
| `template-analyzer.service.ts` | Hybrid检测: 增加`row0IsKvRow`验证（偶数位非数字/斜杠/列表关键词） | 126-127 |
| `template-analyzer.service.ts` | `extractTableTitleFromParagraphs`: 两遍扫描，优先附页/附图 | 534-548 |
| `xml-subtree-inserter.service.ts` | `fillTableFromSource`: 过滤gridSpan全列合并行作为数据行模板 | 129-130 |
| `xml-subtree-inserter.service.ts` | `fillSignatureRowDirect`: 增加策略2跨run锚点姓名插入 | 676-685 |
| `xml-subtree-inserter.service.ts` | `replaceDatePlaceholders`: 增加多run日期占位符替换 | 624-628 |


## Agent Extensions

### SubAgent

- **code-explorer**
- Purpose: 编译修复后端到端验证 Table #8（列表型，非Hybrid）、Table #26（合并行跳过）、Table #27（附页标题识别）的类型识别、样例数据、填充结果
- Expected outcome: Table #8 正确识别为列表型（非Hybrid），数据行使用6格模板填充，签名行姓名正确插入且不换行，日期占位符被清除；Table #26 第二行数据使用6格模板填充（非合并行）；Table #27 标题识别为"XXXXXX年度检查报告附页"