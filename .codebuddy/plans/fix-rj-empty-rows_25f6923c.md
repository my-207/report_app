---
name: fix-rj-empty-rows
overview: 修复 statements.rj 填充后生成空行的根因：模拟 XML 表格表头与模板表头不匹配、DataRecord 数据提取不完整导致 data 数组全空值被 skip。
todos:
  - id: fix-table-headers
    content: 优化 TABLE_HEADERS 列名：使用模板常用措辞提高匹配度
    status: completed
  - id: fix-datarecord-cells
    content: 重写 buildDataRecordCells：直接从 RDF 属性提取检测值、日期、位置、所属管道
    status: completed
  - id: fix-datarecord-merge
    content: 修改 buildChapters：DataRecord 合并为单个表格，避免大量独立表格匹配失败
    status: completed
  - id: verify-compile
    content: 编译验证，确保零新增 TypeScript 错误
    status: completed
    dependencies:
      - fix-table-headers
      - fix-datarecord-cells
      - fix-datarecord-merge
---

## 问题

使用 .rj 知识图谱填充后显示"插入了 2498 行数据"，但最终报告全是空行，没有实际数据。

## 根因

1. **模拟 XML 表头与模板表头不匹配**：`TABLE_HEADERS` 定义的列名（如"河流名称"、"穿越类型"）与模板实际列名（如"名称"、"穿越方式"）措辞不同，`matchHeaders` 匹配度 < 0.4 → 表格未被填充
2. **DataRecord 的 `buildDataRecordCells` 逻辑错误**：假设 `name` 是 `[管道名, 字段名, 字段值]`，实际是 `["0.015", "2025.4.1"]`（数值+日期），导致 `fieldName` 取到数值而非字段名
3. **`fillRowWithData` 遇到空值跳过**：RDF 属性提取为空 → 模拟 `<w:t>` 为空 → `extractCellTexts` 提取空 → `dataRow` 数组空 → 模板行保持空

## 修复方案

修改 `statements-parser.service.ts`，核心改动：

1. 优化 `TABLE_HEADERS` 列名与模板常用词匹配
2. 重写 `buildDataRecordCells`：直接从 RDF 属性提取实际数据，不再猜测 `name` 数组结构
3. 为 DataRecord 数量大的章节，合并为一个表格避免 2498 个独立表格导致匹配失败

## 修改文件

`server/src/services/statements-parser.service.ts` — 仅修改此文件

## 具体修改

### 1. 优化 TABLE_HEADERS（第32-40行）

将列名改为模板中常用的措辞：

- `"河流名称"` → `"名称"`
- `"穿越类型"` → `"穿越方式"`
- `"埋深(m)"` → `"埋深"`
- `"长度(m)"` → `"长度"`
- `"字段名", "字段值"` → `"位置", "检测值", "检测日期", "所属管道"`

### 2. 重写 buildDataRecordCells（第265-280行）

改为直接从 RDF 属性中提取实际数据：

```typescript
private buildDataRecordCells(record: RdfEntity, seq: string): string[] {
  const nameProp = record["http://example.org/report#name"];
  const sourceReport = this.getValue(record["http://example.org/report#sourceReport"]);
  const location = this.getValue(record["http://example.org/report#location"]);
  
  // name 数组：第一个值是检测值，第二个值（如有）是日期
  let detectValue = "";
  let detectDate = "";
  if (nameProp && nameProp.length > 0) {
    detectValue = String(nameProp[0].value || "");
    if (nameProp.length > 1) {
      detectDate = String(nameProp[1].value || "");
    }
  }
  
  return [seq, location, detectValue, detectDate, sourceReport];
}
```

### 3. 修改 buildChapters（第152-184行）

对于 DataRecord 数量超过 50 条的章节，将多条 DataRecord 合并为一个表格（而非每条一个表格），减少表格数量，提高匹配成功率：

```typescript
// 在 buildChapters 中，对 DataRecord 特殊处理：
if (entityType === "DataRecord" && records.length > 50) {
  // 合并为一个表格
  const tableXml = this.buildTableXml(entityType, records);
  tables.push(tableXml);
} else {
  // 其他类型每条记录一个表格（或少量记录合并）
  for (const record of records) {
    tables.push(this.buildTableXml(entityType, [record]));
  }
}
```

不过这个逻辑需要权衡——少量 DataRecord（< 50）可能对应不同的子表格。更安全的做法是：**DataRecord 始终合并为一个表格**，因为模板中检测数据表通常是一张大表。

### 不变的部分

- `filler.service.ts` 完全不变
- `xml-subtree-inserter.service.ts` 完全不变
- API 路由不变
- 前端不变