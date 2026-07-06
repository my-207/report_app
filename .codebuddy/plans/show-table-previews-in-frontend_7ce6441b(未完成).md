---
name: show-table-previews-in-frontend
overview: 两种数据源（.rj 知识图谱 + .docx 源文档）解析后，在前端预览区以表格形式展示所有列表类表格的表头和完整数据行，支持折叠/展开。
todos:
  - id: add-getrowcells
    content: 在 xml-utils.ts 中新增 getRowCells 函数，按 w:tc 单元格提取行数据
    status: pending
  - id: fix-type-comment
    content: 更新 TablePreview.sampleRows 注释为"所有数据行"
    status: pending
  - id: fix-rj-allrows
    content: 修改 statements-parser：返回全部行数据，精简诊断日志为一行汇总
    status: pending
  - id: add-docx-previews
    content: 在 chapter-extractor 中新增 buildTablePreviews 方法，从 Word XML 表格提取预览
    status: pending
    dependencies:
      - add-getrowcells
  - id: fix-docx-api
    content: /upload-source 接口返回中补充 tablePreviews
    status: pending
    dependencies:
      - add-docx-previews
  - id: clean-console-logs
    content: 清理 upload.js 和 preview.js 中的 console.log
    status: pending
  - id: frontend-full-render
    content: 修改 preview.js：渲染全部行 + 折叠/展开交互
    status: pending
  - id: compile-verify
    content: 编译验证并重启服务器测试
    status: pending
    dependencies:
      - add-getrowcells
      - fix-type-comment
      - fix-rj-allrows
      - add-docx-previews
      - fix-docx-api
      - clean-console-logs
      - frontend-full-render
---

## 用户需求

两种数据源（.rj 知识图谱和 .docx 源文档）解析出的列表类表格数据，在前端预览区以完整表格形式展示，数据多时支持折叠/展开。同时清理之前添加的调试 console.log。

## 核心功能

- **.rj 模式表格预览**：展示知识图谱解析出的每个列表型表格的全部数据行（当前只取前3行，需扩展）
- **.docx 模式表格预览**：从 Word 源文档的 XML 表格中提取表头和数据行，新增预览能力（当前为空数组）
- **折叠/展开交互**：超过 10 行时默认仅显示前 10 行，点击按钮展开全部或收起
- **清理调试代码**：移除 upload.js 和 preview.js 中的 console.log

## 技术方案

### 1. 后端：.rj 模式 — 返回全部行

**文件**：`server/src/services/statements-parser.service.ts`

- 第 206 行：`Math.min(3, records.length)` → `records.length`，遍历全部记录
- 第 187-201 行：删除逐条属性打印日志，保留一条汇总日志 `[章节 X] 类型: N条记录`

### 2. 后端：.docx 模式 — 新增 `buildTablePreviews`

**文件**：`server/src/services/chapter-extractor.service.ts`

在 `analyze()` 方法中，统计键值对表格后调用新增的 `buildTablePreviews(chapters)` 方法，替换当前的 `tablePreviews: []`。

**新增方法逻辑**：

```typescript
private buildTablePreviews(chapters: Chapter[]): TablePreview[] {
  const previews: TablePreview[] = [];
  for (const ch of chapters) {
    for (const tblXml of ch.tables) {
      if (isKeyValueTable(tblXml)) continue; // 跳过键值对表
      const rows = this.extractAllTrRows(tblXml);
      if (rows.length < 2) continue; // 至少需要表头+1行数据
      const headers = getRowCellTexts(rows[0]);
      const dataRows: string[][] = [];
      for (let i = 1; i < rows.length; i++) {
        const cells = getRowCellTexts(rows[i]);
        if (cells.length === 0) continue; // 跳过空行
        dataRows.push(cells);
      }
      if (dataRows.length === 0) continue;
      previews.push({
        sectionId: ch.id,
        entityType: "列表表格",
        headers,
        rowCount: dataRows.length,
        sampleRows: dataRows,
      });
    }
  }
  return previews;
}

/** 提取表格中所有 <w:tr> 行 XML 字符串 */
private extractAllTrRows(tableXml: string): string[] {
  const rows: string[] = [];
  const trRegex = /<w:tr[ >]/g;
  let m: RegExpExecArray | null;
  while ((m = trRegex.exec(tableXml)) !== null) {
    const tr = extractTagContent(tableXml, m.index, "w:tr");
    if (tr) rows.push(tr);
  }
  return rows;
}
```

注意：`getRowCellTexts()` 目前返回的是 `<w:t>` 文本数组，但它不区分单元格边界（它只是扫描整行的所有 `<w:t>` 标签）。对于包含多 run 的单元格，它会把同一单元格的文本拆成多个元素。需要改为按 `<w:tc>` 单元格提取。

需要在 `xml-utils.ts` 中新增一个更精确的函数 `getRowCells(rowXml)`：提取每个 `<w:tc>` 单元格内的所有 `<w:t>` 拼接文本。

### 3. 后端：类型注释更新

**文件**：`server/src/types/index.ts`

- 第 234 行：注释从 `/** 样本行（前3行） */` 改为 `/** 所有数据行 */`

### 4. 后端：.docx 模式 API 补充

**文件**：`server/src/routes/api.ts`

- `/upload-source` 接口（第 177-191 行）的返回中补充 `tablePreviews: analysis.tablePreviews`

### 5. 前端：清理调试代码

**文件**：`public/js/upload.js`

- 删除第 150-151 行的 console.log

**文件**：`public/js/preview.js`

- 删除第 51-52 行的 console.log

### 6. 前端：全部行渲染 + 折叠交互

**文件**：`public/js/preview.js`

修改 `renderPreview()` 中的表格渲染逻辑（第 56-83 行）：

- `sampleRows` 改为渲染全部行，不再有"还有 N 行"提示
- 新增 `renderTableRows(rows, maxVisible)` 辅助函数：
- `rows.length <= 10`：直接渲染全部
- `rows.length > 10`：前10行正常渲染 + 剩余行包裹在 `<tbody class="collapsible-rows hidden">` + 底部添加展开按钮
- 展开按钮绑定 onclick 事件，切换折叠区域的显示和按钮文案

**文件**：`public/css/style.css`

- 补充 `.collapsible-rows.hidden { display: none; }`
- 补充 `.table-expand-btn` 样式（居中、蓝色链接风格）

### 7. 精度修正：按单元格提取行数据

当前 `getRowCellTexts` 不区分单元格边界。需要在 `xml-utils.ts` 中新增：

```typescript
export function getRowCells(rowXml: string): string[] {
  const cells: string[] = [];
  const tcRegex = /<w:tc[ >]/g;
  let m: RegExpExecArray | null;
  while ((m = tcRegex.exec(rowXml)) !== null) {
    const tc = extractTagContent(rowXml, m.index, "w:tc");
    if (tc) {
      const texts = extractWtTexts(tc);
      cells.push(texts.join(""));
    }
  }
  return cells;
}
```

`chapterExtractor` 的 `buildTablePreviews` 使用 `getRowCells` 替代 `getRowCellTexts`，确保每个单元格只产生一个文本值。