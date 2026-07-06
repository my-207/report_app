---
name: fix-table-format-detection-v5
overview: 修复两个根因级表格格式识别缺陷：(1) KV表因"编号"子串误判为列表型 + vMerge restart/continue处理错误；(2) 混合表因Hybrid检测条件过严误判为KV型。同时整合已有plan中的dataTableToXml和fillKeyValueRow vMerge继承修复。
todos:
  - id: fix-list-keywords
    content: "修复 xml-utils.ts: LIST_HEADER_KEYWORDS 从正则子串匹配改为数组整格匹配，isKeyValueTable 中 some() 改用 includes()"
    status: completed
  - id: fix-hybrid-detection
    content: "修复 template-analyzer.service.ts: Hybrid检测放宽条件(原始格数+移除无关条件+降阈值)、countKvPairsInRow计空值对、双层表头vMerge检测增强"
    status: completed
    dependencies:
      - fix-list-keywords
  - id: fix-kv-extraction
    content: "修复 template-analyzer.service.ts: KV标签提取改为标签驱动扫描，移除kvStartIdx逻辑，vMerge restart保留标签"
    status: completed
    dependencies:
      - fix-hybrid-detection
  - id: fix-kv-filling
    content: "修复 xml-subtree-inserter.service.ts: fillKeyValueRow移除skipFirstCol，extractKeyValuePairs改为标签驱动扫描"
    status: completed
    dependencies:
      - fix-kv-extraction
  - id: compile-restart
    content: 编译TypeScript并重启服务器
    status: completed
    dependencies:
      - fix-kv-filling
  - id: e2e-verify
    content: "用 [subagent:code-explorer] 端到端验证 Table #3 和 #16 的类型识别、样例数据、填充结果"
    status: completed
    dependencies:
      - compile-restart
---

## 用户需求

用户报告了两个表格格式识别问题，导致样例数据生成和填充错误：

### 问题A：(3-1) 埋地管道外防腐层质量检测报告（Table #16）— 混合表误判

- 实际结构：Row 0 为3组KV对（gridSpan=2），Row 1-2 为两层列表表头（vMerge + gridSpan超表头），Row 3-4 为数据行
- 当前问题：Hybrid检测三重失败（过滤空值后格数<6、格数相等条件不满足、countKvPairs要求值非空得0），误判为KV表，列表表头和数据行被当作KV key提取

### 问题B：(1-1) 原始资料审查报告（Table #3）— KV表误判为列表

- 实际结构：Row 0-11为标准KV（key2有gridSpan=2），Row 12-13前两列vMerge（restart+continue），Row 14-15为整行KV
- 当前问题："管道编号"子串匹配"编号"列表关键词被误判为列表型；vMerge处理对restart和continue一视同仁跳过导致配对错位

### 用户要求

分析如上情况，给出合理通用的解析规则，并给出修改建议。

## 产品概述

修复报告生成系统中表格类型检测、KV标签提取、KV填充三个环节的缺陷。提出一套通用的表格解析规则，使系统能正确识别含合并单元格的混合表和KV表，生成匹配的样例数据，并正确填充。

## 核心功能

### 通用解析规则（5条）

1. **列表表头关键词匹配**：整格匹配替代子串匹配，"管道编号"不匹配"编号"
2. **混合表检测**：用原始物理格数（不过滤空值），移除无关条件，countKvPairs计空值对
3. **双层表头检测**：Row 1有vMerge restart时检查Row 2为子表头
4. **KV标签提取**：标签驱动扫描（非固定i+=2），vMerge restart保留标签、continue跳过
5. **KV填充**：移除skipFirstCol，"下一格必须为空"守卫已覆盖所有合并场景

## 技术栈

- TypeScript (Node.js 后端, Express.js)
- Word XML 直接操作（docx unpack/pack 工具链）
- 无前端变更

## 根因分析

### 根因1：LIST_HEADER_KEYWORDS 子串匹配误判（问题B）

**文件**: `server/src/utils/xml-utils.ts` 第193行、第211行

```typescript
const LIST_HEADER_KEYWORDS = /序号|编号|检验项目|.../;
// 第211行: some() 只需1个子串命中就判为列表
const hasListKeyword = row0Cells.some(c => LIST_HEADER_KEYWORDS.test(c));
```

"管道编号" 子串匹配 "编号" → `hasListKeyword = true` → Table #3 误判为列表型表格。

### 根因2：Hybrid 检测条件过严（问题A）

**文件**: `server/src/services/template-analyzer.service.ts` 第116-125行

三重失败：

1. 第118行 `.filter(t => t && t.length < 50)` 过滤空值 → Row 0 的 `["设备名称","","管道规格","","环境条件",""]` 过滤后只剩3个 → `3 < 6` 失败
2. 第125行 `row0Cells.length !== row1Cells.length` → 6 === 6 → false → 失败（无关条件）
3. 第123行 `countKvPairsInRow` 第491-492行要求 label AND value 都非空 → 模板值为空 → 0 对 → 失败

### 根因3：countKvPairsInRow 要求值非空

**文件**: `server/src/services/template-analyzer.service.ts` 第486-497行

```typescript
if (label && label.length > 0 && label.length < 15 && !/^\d+$/.test(label)
    && value && value.length > 0 && !/^\s*$/.test(value)) {  // ← 要求值非空
  count++;
}
```

模板中KV值单元格是空的（待填），所以 `value.length > 0` 永远为 false → count = 0。

### 根因4：KV提取 vMerge restart 被错误跳过（问题B）

**文件**: `server/src/services/template-analyzer.service.ts` 第185-191行

```typescript
if (firstTc && /<w:vMerge\b/.test(firstTc)) {
  kvStartIdx = 1; // 跳过第一列
}
```

`/<w:vMerge\b/` 同时匹配 restart 和 continue → restart 行的标签（如"管道级别"）被跳过 → 该KV对丢失。

### 根因5：fillKeyValueRow skipFirstCol 逻辑有害

**文件**: `server/src/services/xml-subtree-inserter.service.ts` 第553-560行

同样的 `/<w:vMerge\b/` 逻辑，跳过所有 vMerge 首列。但 `i--` 扫描 + "下一格必须为空"守卫已经能正确处理：

- Table #1 Row 6: "性能参数" → 下一格"管道长度"非空 → 自然跳过（类别列）
- Table #3 Row 12: "管道级别" → 下一格""空 → 正确识别为KV key

`skipFirstCol` 反而阻止了合法KV key（"管道级别"）的填充。

### 根因6：extractKeyValuePairs 固定 i+=2 不适应合并

**文件**: `server/src/services/xml-subtree-inserter.service.ts` 第497-515行

`i += 2` 假设严格的 key-value 交替，但 gridSpan 和 vMerge 会打破交替模式。

## 实现方案

### 修复1：LIST_HEADER_KEYWORDS 整格匹配

**文件**: `server/src/utils/xml-utils.ts` 第193行、第210-215行

将 `LIST_HEADER_KEYWORDS.test(c)` 子串匹配改为整格匹配：

```typescript
// 修改前: 子串匹配
const LIST_HEADER_KEYWORDS = /序号|编号|检验项目|.../;
const hasListKeyword = row0Cells.some(c => LIST_HEADER_KEYWORDS.test(c));

// 修改后: 整格匹配（trimmed cell === keyword）
const LIST_HEADER_KEYWORDS = ['序号','编号','检验项目','检查项目','检查内容','检查结果','页码','附图','备注','日期','检测结果','处理措施','事件类型','位置','深度','壁厚','规格型号'];
const hasListKeyword = row0Cells.some(c => LIST_HEADER_KEYWORDS.includes(c.trim()));
```

"管道编号".trim() !== "编号" → 不匹配 → Table #3 不再误判为列表。

### 修复2：Hybrid 检测条件放宽

**文件**: `server/src/services/template-analyzer.service.ts` 第116-152行

```typescript
// 修改前
const row0Cells = getCellMergedTexts(allTrMatches[0].content).filter(t => t && t.length < 50);
if (row0Cells.length >= 6 && row1Cells.length >= 3
  && row0Cells.length !== row1Cells.length && kvPairCount >= 3) {

// 修改后
const row0RawCells = getCellMergedTexts(allTrMatches[0].content);
const row0Cells = row0RawCells.filter(t => t && t.length < 50);
const row1RawCells = getCellMergedTexts(allTrMatches[1].content);
const row1Cells = row1RawCells.filter(t => t && t.length < 50);
const kvPairCount = countKvPairsInRow(row0RawCells); // 用原始格数计数
if (row0RawCells.length >= 4 && row1Cells.length >= 3 && kvPairCount >= 2) {
  // 移除 row0Cells.length !== row1Cells.length（无关条件）
  // 阈值从 >=6 降到 >=4（原始物理格数），>=3 降到 >=2
```

### 修复3：countKvPairsInRow 计空值对

**文件**: `server/src/services/template-analyzer.service.ts` 第486-497行

```typescript
// 修改后: 标签非空即可，值是否为空不影响计数（模板值本就是空的）
function countKvPairsInRow(cells: string[]): number {
  let count = 0;
  for (let i = 0; i < cells.length - 1; i += 2) {
    const label = cells[i];
    if (label && label.length > 0 && label.length < 50 && !/^\d+$/.test(label)) {
      count++; // 不检查 value 是否非空
    }
  }
  return count;
}
```

### 修复4：双层表头检测增强（次要 — fillTableFromSource 已有智能表头扫描）

**文件**: `server/src/services/template-analyzer.service.ts` 第141-149行

**重要发现**：`fillTableFromSource`（xml-subtree-inserter.service.ts 第82-103行）已有智能表头扫描逻辑——从 `dataStartRow` 开始，连续检测含 vMerge/gridSpan 的行作为表头，直到遇到不含合并属性的行才作为数据行。对于 Table#16（dataStartRow=1），Row1(vMerge)+Row2(vMerge)自动识别为表头，Row3开始填数据。**因此 hybridListHeaderRows 的精确值不影响数据填充，只影响样例数据的 columns 定义（次要）**。

修复4仍保留以改善样例数据 columns 的准确性：

```typescript
// 修改后: 也检查 Row 1 是否有 vMerge restart（双层表头标志）
if (allTrMatches.length >= 3) {
  const row1HasVMerge = /<w:vMerge\s+w:val="restart"/.test(allTrMatches[1].content);
  if (row1Cells.length <= 3 || row1HasVMerge) {
    const row2Cells = getCellMergedTexts(allTrMatches[2].content).filter(t => t && t.length < 50);
    // 放宽阈值: >=3（原>=4），因为子表头过滤空值后可能只剩3个
    if (row2Cells.length >= 3 && row2Cells.length > row1Cells.length) {
      listHeaderCells = row2Cells;
      hybridListHeaderRows = 2;
    }
  }
}
```

### 修复5：KV提取智能 kvStartIdx（奇偶性+vMerge 区分类别列与KV标签）

**文件**: `server/src/services/template-analyzer.service.ts` 第175-201行

**原方案缺陷**：标签驱动扫描+"下一格为空"条件会排除已有值的KV对（Table#3 Row0-11值格有样例值→4个key只提取到1个）。

**修正方案**：保留 `i += 2` 配对 + 智能kvStartIdx。判据：**奇数格+首格vMerge=类别列(kvStartIdx=1)，偶数格=标准KV(kvStartIdx=0)**。

```typescript
// 修改后: 奇偶性+vMerge 智能kvStartIdx
const kvKeys: string[] = [];
for (const tr of allTrMatches) {
  const rowCells = getCellMergedTexts(tr.content);
  let kvStartIdx = 0;
  // 奇数格 + 首格vMerge → 第一列是独立的类别列（如"性能参数"），需跳过
  // 偶数格 → 无独立类别列，i+=2从0开始正确配对
  if (rowCells.length % 2 === 1 && rowCells.length > 0) {
    const firstTcRegex = /<w:tc[ >]/;
    const firstTcMatch = firstTcRegex.exec(tr.content);
    if (firstTcMatch) {
      const firstTc = extractTagContent(tr.content, firstTcMatch.index, "w:tc");
      if (firstTc && /<w:vMerge\b/.test(firstTc)) {
        kvStartIdx = 1;
      }
    }
  }
  for (let i = kvStartIdx; i < rowCells.length - 1; i += 2) {
    const label = rowCells[i];
    if (label && label.length > 0 && label.length < 50 && !/^\d+$/.test(label)) {
      kvKeys.push(label);
    }
  }
}
```

**全表验证结果**（28个表格扫描）：

| 表 | 行 | 格数 | 奇偶 | 首格vMerge | kvStartIdx | 说明 |
| --- | --- | --- | --- | --- | --- | --- |
| T#1 R6-9 | 类别列 | 5 | 奇 | restart/cont | 1 | "性能参数"跳过，key1/key2正确 ✓ |
| T#3 R0-11 | 标准KV | 4 | 偶 | 无 | 0 | key+val交替正确 ✓ |
| T#3 R12 | vMerge restart KV | 4 | 偶 | restart | 0 | "管道级别"保留 ✓ |
| T#3 R13 | vMerge continue KV | 4 | 偶 | continue | 0 | 首格空跳过，"绝热层厚度"提取 ✓ |
| T#3 R14-15 | 整行KV | 2 | 偶 | 无 | 0 | 正确 ✓ |
| T#11/23/26 R0 | 列表表头 | 奇 | restart | 1 | 不进入KV提取(列表表) — 不受影响 |


列表表头行(T#11/23/26)虽满足"奇数+vMerge"，但它们所在的表被判为列表型(非KV)，不进入此KV提取逻辑。

### 修复6：fillKeyValueRow 移除 skipFirstCol

**文件**: `server/src/services/xml-subtree-inserter.service.ts` 第553-564行

```typescript
// 修改后: 删除 skipFirstCol 逻辑（第553-560行和第564行）
// i-- 扫描 + "下一格必须为空"守卫已覆盖所有场景:
//   - 类别列: 下一格非空 → 自然跳过
//   - vMerge restart key: 下一格空 → 正确填充
//   - vMerge continue: 无文本 → 自然跳过

for (let i = tcMatches.length - 2; i >= 0; i--) {
  // 移除: if (skipFirstCol && i === 0) continue;
  const valueTc = tcMatches[i + 1];
  const labelText = i < rowCells.length ? rowCells[i] : "";
  if (!labelText) continue;
  // ... 其余不变
}
```

### 修复7：extractKeyValuePairs 保留 i+=2 配对（源数据值格有值，无需智能跳过）

**文件**: `server/src/services/xml-subtree-inserter.service.ts` 第497-515行

源数据XML由 `kvToXml` 生成，格式严格为 `[key1,val1,key2,val2,...]`（无类别列），`i+=2` 配对正确。保持原逻辑不变，仅移除对纯占位符值的过滤限制：

```typescript
// 不修改: extractKeyValuePairs 保持原有 i+=2 逻辑
// 源数据由 kvToXml 生成，格式严格交替，i+=2 正确
```

## 实现要点

### 性能分析

- 保留 `i += 2` 配对，无复杂度变化
- Hybrid 检测新增 vMerge 正则检测，仅对 Row 1 执行一次，可忽略
- 不修改 `getCellMergedTexts`（被多处引用，保持语义不变）
- 不修改 `extractKeyValuePairs`（源数据格式严格交替，i+=2 正确）
- 不修改 `fillTableFromSource`（已有智能表头扫描，自动处理双层表头）

### 爆炸半径控制

- `LIST_HEADER_KEYWORDS` 从正则改为数组，`isKeyValueTable` 内部使用方式同步修改，不影响外部
- `countKvPairsInRow` 是私有函数，仅 Hybrid 检测使用
- `fillKeyValueRow` 移除 `skipFirstCol`，不影响函数签名
- `dataTableToXml` 已在之前修复（`Array.isArray(r)` 兼容），无需再改

### 日志策略

- Hybrid 检测成功/失败时输出 `logger.info`（含 Row0 格数、KV对数、判定结果）
- KV提取数量变化时输出 `logger.info`
- 不新增 debug 级日志

## 目录结构

```
server/src/
├── utils/
│   └── xml-utils.ts                    # [MODIFY] LIST_HEADER_KEYWORDS: 正则→数组+整格匹配; isKeyValueTable: some()→includes()
├── services/
│   ├── template-analyzer.service.ts    # [MODIFY] Hybrid检测: 放宽条件+双层表头增强; countKvPairsInRow: 计空值对; KV提取: 智能kvStartIdx(奇偶性+vMerge)
│   ├── xml-subtree-inserter.service.ts # [MODIFY] fillKeyValueRow: 移除skipFirstCol
│   └── filler.service.ts              # [不修改] dataTableToXml 已修复; fillTableFromSource已有智能表头扫描
└── types/
    └── index.ts                        # [不修改]
```

## 修改文件清单

| 文件 | 修改点 | 行号 |
| --- | --- | --- |
| `server/src/utils/xml-utils.ts` | `LIST_HEADER_KEYWORDS`: 正则→数组；`isKeyValueTable`: `some(c => test(c))` → `some(c => includes(c.trim()))` | 193, 211 |
| `server/src/services/template-analyzer.service.ts` | Hybrid检测: 用原始格数+移除无关条件+降阈值；`countKvPairsInRow`: 移除值非空要求；双层表头: 增加vMerge检测+放宽阈值；KV提取: 智能kvStartIdx(奇偶性+vMerge)替代原restart/continue统一跳过 | 116-152, 175-201, 486-497 |
| `server/src/services/xml-subtree-inserter.service.ts` | `fillKeyValueRow`: 移除skipFirstCol(第553-560,564行) | 553-564 |


## Agent Extensions

### SubAgent

- **code-explorer**
- Purpose: 编译修复后扫描全部28个表格，验证 Table #3 (KV表) 和 Table #16 (混合表) 的类型识别、样例数据生成、填充结果
- Expected outcome: Table #3 正确识别为KV表（非列表），"管道级别"等vMerge restart标签被正确提取和填充；Table #16 正确识别为混合表，Row 0 的3组KV对和 Row 3-4 的列表数据行均正确填充