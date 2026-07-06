---
name: fix-kv-table-detection
overview: 修复键值对表格识别逻辑：放宽 isKeyValueTable 判断条件，不再要求 Value 单元格为空（因为源文档中 Value 已有数据），只检查偶数位是否有标签文本
todos:
  - id: fix-is-key-value-table
    content: 修改 xml-utils.ts 中 isKeyValueTable 判断条件，去掉 emptyCount 要求
    status: pending
  - id: fix-kv-count-stat
    content: 修改 chapter-extractor.service.ts 中 keyValueCellCount 统计为 pairCount（键值对总数）
    status: pending
    dependencies:
      - fix-is-key-value-table
  - id: fix-preview-label
    content: 修改 preview.js 中前端展示标签，将"可填充单元格"改为"键值对数"
    status: pending
    dependencies:
      - fix-kv-count-stat
  - id: compile-verify
    content: 编译验证，确保零 linter 错误
    status: completed
    dependencies:
      - fix-is-key-value-table
      - fix-kv-count-stat
---

## 问题描述

源文档上传后，数据预览页面的键值对统计为空；填充结果统计全为0。

## 根因

`isKeyValueTable` 判断条件 `labelCount >= 2 && emptyCount >= 2` 要求 Value 单元格为空。但源文档（原始MD.docx）是已填充报告，Value 单元格已有实际数据（如"无"、"2003年"），导致 emptyCount=0，45个表格全被判为普通列表型表格。

## 修复目标

1. 放宽 `isKeyValueTable` 判断：只检查偶数位置是否有标签文本，不要求奇数位为空
2. 前端预览展示调整为"键值对表数"和"键值对总数"

## 修改文件

### 1. `server/src/utils/xml-utils.ts` — 放宽 isKeyValueTable

将第176行判断条件从：

```typescript
return labelCount >= 2 && emptyCount >= 2;
```

改为：

```typescript
return labelCount >= 2;
```

同时删除不再需要的 `emptyCount` 变量及其累加逻辑（第167行、第172行）。

### 2. `public/js/preview.js` — 前端标签调整

将第46行展示的标签从 `"可填充单元格"` 改为 `"键值对数"`，因为源文档的 `keyValueCellCount` 此时代表的是模板中待填充的空单元格数（源文档 Value 已满时为0），而用户上传源文档时期望看到的是源文档中的键值对总数。但 `countKeyValuePairs` 返回的 `cellCount` 统计的是"空值单元格数"，源文档中全有数据所以 cellCount=0。

更好的方案：预览展示 `keyValueTableCount`（键值对表数）即可，不需要单独展示 cellCount。或者调整 API 返回的 `keyValueCellCount` 为 `pairCount`（键值对总数）。

实际分析：`countKeyValuePairs` 在 `chapter-extractor.analyze()` 中被调用，它统计的是**源文档模板中待填充的空单元格数**（cellCount），源文档已填充所以 cellCount=0。应改为统计 pairCount。

修改 `chapter-extractor.service.ts` 第70行：

```typescript
keyValueCellCount += kv.pairCount;  // 改为统计键值对总数
```

前端标签同步改为"键值对数"。