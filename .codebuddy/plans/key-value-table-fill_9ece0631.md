---
name: key-value-table-fill
overview: 新增键值对表格填充能力：从模板表格中提取标签Key（如"管道名称"），到源文档同表格中查找对应Value，填入模板标签后的空单元格。按表格区分，Key不跨表混淆。
todos:
  - id: add-keyvalue-methods
    content: 在 xml-subtree-inserter.service.ts 中新增 fillKeyValueTable、extractKeyValuePairs、fillCellWithKeyValue 三个方法
    status: completed
  - id: add-type-check
    content: 在 filler.service.ts 阶段2增加 isKeyValueTable 判断和分流逻辑
    status: completed
    dependencies:
      - add-keyvalue-methods
  - id: compile-verify
    content: 编译验证，确保零 linter 错误
    status: completed
    dependencies:
      - add-keyvalue-methods
      - add-type-check
---

## 用户需求

核心原则（已确认）：

1. 源文档有数据就填充，没有就保留模板原样
2. 填充的模板文件，格式不要有任何变化，只补充数据内容
3. 数据行超出模板空行时，克隆模板最后一行追加到表格末尾
4. **键值对表格填充**：模板表格中标签后面的空白单元格，从源文档同表格中按Key匹配获取Value填入。按表格区分Key，不跨表格混淆。

## 示例场景

模板表格4（管道参数表）结构：

```
行1: 管道名称 | [空]     | 管道编号 | [空]
行2: 管理单位 | [空]     | 起止位置 | [空]
```

源文档同表格：

```
行1: 管道名称 | XX管线   | 管道编号 | GD-001
行2: 管理单位 | XX公司   | 起止位置 | K0-K50
```

填充后：

```
行1: 管道名称 | XX管线   | 管道编号 | GD-001
行2: 管理单位 | XX公司   | 起止位置 | K0-K50
```

## 技术方案

### 整体策略

当前 `fillBySubtreeCopy` 阶段2对所有表格统一使用 `fillTableFromSource`（列表型填充：表头匹配 + 按列逐行填入）。新增键值对表格填充路径：先判断表格类型，键值对表格使用新方法 `fillKeyValueTable`。

```mermaid
flowchart TD
    A[阶段2: 遍历源章节tables] --> B{findMatchingTemplateTable}
    B -->|匹配到| C{isKeyValueTable?}
    C -->|是键值对| D[fillKeyValueTable]
    C -->|是列表型| E[fillTableFromSource]
    D --> F[提取源表格Key-Value映射]
    F --> G[遍历模板行, 按Key匹配填入Value]
    G --> H[返回 {xml, cellsFilled}]
    E --> I[现有列表型填充逻辑]
```

### 修改1: xml-subtree-inserter.service.ts — 新增 fillKeyValueTable

在 `XmlSubtreeInserter` 类中新增三个方法：

**fillKeyValueTable(targetXml, targetTableIndex, sourceTableXml)**

1. 在 targetXml 中定位目标表格（复用现有 tblRegex 定位逻辑）
2. 调用 `extractKeyValuePairs(sourceTableXml)` 构建源数据映射
3. 遍历模板表格每一行，提取每行中所有单元格文本
4. 对每个非空标签单元格，在映射中查找匹配的Value
5. 找到Value后，将该行中标签后的下一个空 `<w:tc>` 的第一个 `<w:t>` 文本替换为Value
6. 返回 `{ xml, cellsFilled }`

**extractKeyValuePairs(sourceTableXml): Map<string, string>**

1. 遍历源表格所有 `<w:tr>` 行
2. 对每行提取所有 `<w:tc>` 的文本
3. 按"标签-值"配对：偶数索引（0,2,4...）为Key，奇数索引（1,3,5...）为Value
4. Key非空时存入Map，Value可为空
5. 返回 `Map<string, string>`

**fillCellWithKeyValue(targetTbl, key, value): string**

1. 遍历模板表格所有 `<w:tr>` 行
2. 在每行中查找包含key文本的 `<w:tc>`
3. 找到后，定位该行中key单元格之后第一个文本为空的 `<w:tc>`
4. 将该空单元格的第一个 `<w:t>` 文本替换为value
5. 返回修改后的表格XML

### 修改2: filler.service.ts — 阶段2增加表格类型判断

在 `fillBySubtreeCopy` 阶段2的表格匹配成功后（第148-154行），增加分流逻辑：

```typescript
if (matchResult !== null) {
  const { tableIndex } = matchResult;
  if (this.isKeyValueTable(sourceTable)) {
    // 键值对表格：按Key匹配填入Value
    const fillResult = xmlSubtreeInserter.fillKeyValueTable(xml, tableIndex, sourceTable);
    if (fillResult.cellsFilled > 0) {
      xml = fillResult.xml;
      stats.tablesFilled++;
      stats.rowsInserted += fillResult.cellsFilled;
    }
  } else {
    // 列表型表格：现有逻辑
    const fillResult = xmlSubtreeInserter.fillTableFromSource(xml, tableIndex, sourceTable);
    if (fillResult.rowsFilled > 0) {
      xml = fillResult.xml;
      stats.tablesFilled++;
      stats.rowsInserted += fillResult.rowsFilled;
    }
  }
}
```

**isKeyValueTable(sourceTableXml): boolean**
判断逻辑：

1. 提取源表格所有行的单元格文本
2. 检查第一行（跳过多级表头合并行）的文本模式
3. 如果第一行包含至少2个中文标签文本，且标签和值交替排列（即第1、3、5...列有文本，第2、4、6...列可能为空）→ 判定为键值对表格
4. 具体：取前两行，如果第一行有非空单元格且相邻单元格之间是"有文本-无文本-有文本-无文本"交替模式，则判定为键值对表格

### 涉及文件

| 文件 | 修改内容 |
| --- | --- |
| `server/src/services/xml-subtree-inserter.service.ts` | 新增 `fillKeyValueTable`、`extractKeyValuePairs`、`fillCellWithKeyValue` 三个方法 |
| `server/src/services/filler.service.ts` | 阶段2增加 `isKeyValueTable` 判断 + 分流逻辑 |