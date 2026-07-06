---
name: fix-kv-and-list-tables
overview: 修复双层表头列表型表格 + 键值对表格的数据结构提取，共涉及 5 个缺陷在 3 个文件中
todos:
  - id: fix-isKeyValueTable
    content: 修复 xml-utils.ts isKeyValueTable()：跳过合并标题行 row0，多行（至多3行）扫描累积 KV 模式证据
    status: completed
  - id: fix-analyze-kv-allrows
    content: 修复 template-analyzer.service.ts analyze() KV 分支：遍历表格所有行，从每行所有偶数位提取全部键名并去重
    status: completed
    dependencies:
      - fix-isKeyValueTable
  - id: compile-verify
    content: 编译验证 npx tsc --noEmit，确认零错误
    status: completed
    dependencies:
      - fix-isKeyValueTable
      - fix-analyze-kv-allrows
---

## 用户需求

修复模板分析阶段 KV 表数据结构提取的 3 个缺陷，确保"样例数据填充"能正确生成所有键值对。

用户补充要求：**KV 表每一行遍历所有列**（`for i=0; i<cells.length-1; i+=2`），从偶数位提取全部标签键，不限于前 N 对。

## 核心功能

- `isKeyValueTable()` 支持带合并标题行的 KV 表识别（跳过 row 0 的标题行，扫描 row 1+ 的数据行）
- `isKeyValueTable()` 多行累积扫描（至多 3 行），提升短值/等长标签场景下的判断准确率
- `analyze()` KV 分支遍历表格**所有行**，从每行的偶数位单元格提取全部键名
- 编译零错误验证

## 技术方案

### Bug 4 修复 — `isKeyValueTable()` 多行扫描 + 标题行跳过

**文件**: `server/src/utils/xml-utils.ts`，函数 `isKeyValueTable()`（第192-246行）

**当前问题**: 只检查第一行 `cells = getCellMergedTexts(firstTr)`。当 row 0 是合并标题行（1-2 个 cell + gridSpan），`cells.length < 4` 直接返回 false。

**修复策略**:

1. 提取表格所有行 `allRows = findAllTags(tableXml, "w:tr")`
2. 检测 row 0 是否为合并标题行：`row0Cells.length <= 2` 且表格至少有 2 行 → `startRowIdx = 1`
3. 从 `startRowIdx` 开始扫描至多 3 行，累积 `labelCount`、`valueTextCount`、`labelTotalLen`、`valueTotalLen`
4. 复用现有 3 个策略判断（多行累积数据天然增强策略 2/3 的准确性）

```typescript
// 伪代码结构
const allRows = findAllTags(tableXml, "w:tr");
let startRowIdx = 0;
const row0Cells = getCellMergedTexts(allRows[0].content);
if (row0Cells.length <= 2 && allRows.length > 1) {
  startRowIdx = 1; // 跳过合并标题行
}

// 扫描至多 3 行累积数据
const rowsToCheck = Math.min(allRows.length - startRowIdx, 3);
for (let r = startRowIdx; r < startRowIdx + rowsToCheck; r++) {
  const cells = getCellMergedTexts(allRows[r].content);
  for (let i = 0; i < cells.length - 1; i += 2) {
    // 遍历所有列，累积 labelCount/valueTextCount/长度
  }
}
// 复用原有 3 个策略
```

### Bug 5 修复 — `analyze()` KV 分支全行遍历

**文件**: `server/src/services/template-analyzer.service.ts`，第71-83行

**当前问题**: KV 分支只从 `headers`（来自第一行）提取 kvKeys。多行 KV 表丢失 row 1+ 的键。

**修复策略**: 当 `isKv=true`，用 `findAllTags(tbl, "w:tr")` 遍历所有行，每行调用 `getCellMergedTexts()`，提取偶数位单元格（`i += 2`）加入 kvKeys。

```typescript
// 伪代码（替换原第71-83行）
if (isKv) {
  const kvKeys: string[] = [];
  const allTrMatches = findAllTags(tbl, "w:tr");
  for (const tr of allTrMatches) {
    const cells = getCellMergedTexts(tr.content);
    // 用户要求：遍历所有列
    for (let i = 0; i < cells.length - 1; i += 2) {
      const label = cells[i];
      if (label && label.length > 0 && label.length < 50) {
        kvKeys.push(label);
      }
    }
  }
  // 去重：同一 key 可能在多行出现（如签名行也含"检验日期"）
  const uniqueKeys = [...new Set(kvKeys)];
  sections.push({
    sectionId: `table_${tblIdx}`,
    placeholderFields: [],
    tables: [{ tableIndex: tblIdx, isKeyValue: true, kvKeys: uniqueKeys, columns: [] }],
    signaturePosition: null,
  });
}
```

### Bug 6 修复 — 策略 2/3 自动增强

多行扫描（Bug 4 修复）天然解决此问题：3 行累积 6 对键值 → `labelCount >= 4` → 策略 3 生效；多行混合长度 → 平均长度差异更显著 → 策略 2 更易通过。无需额外修改策略逻辑。

### 不变更部分

- `TemplateSection`、`SectionData`、`KeyValuePair` 接口不修改
- `generateSampleData()` 已支持任意数量的 kvKeys → 无需修改
- `fillKeyValueTable()` / `extractKeyValuePairs()` 已遍历所有行所有列 → 无需修改
- 列表型表格双层表头修复（上轮已生效） → 不重复修改