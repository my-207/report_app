---
name: skip-missing-data-fix
overview: 修复 fillBySubtreeCopy 填充逻辑：源文档中找不到对应数据时，跳过该占位符/表格，保持模板原有内容不变。涉及 chapter-extractor（移除 fallback 默认值）、filler.service（占位符替换跳过空值）、xml-subtree-inserter（表格填充跳过无匹配行）。
todos:
  - id: fix-extract-basicinfo
    content: 修复 chapter-extractor.service.ts：extractBasicInfo() 所有字段找不到时返回空字符串，移除全部硬编码默认值
    status: completed
  - id: fix-replace-placeholders
    content: 修复 filler.service.ts：replacePlaceholders() 字段值为空时跳过不替换，签名日期只在有真实数据时才替换
    status: completed
    dependencies:
      - fix-extract-basicinfo
  - id: fix-table-empty-skip
    content: 修复 xml-subtree-inserter.service.ts：fillTableFromSource() sourceRows为空时提前返回原XML；fillBySubtreeCopy阶段2跳过无数据行的表格
    status: completed
  - id: compile-verify
    content: 编译验证所有修改
    status: completed
    dependencies:
      - fix-extract-basicinfo
      - fix-replace-placeholders
      - fix-table-empty-skip
---

## 用户需求

模板中需要填充的占位符（X占位符），如果在原始MD源文档中能找到对应的真实数据，就填充进去；找不到的，保持模板原样不动，不使用假数据/默认值填充。

## 核心修复点

1. **chapterExtractor.extractBasicInfo()**：所有字段找不到数据时返回空字符串 `""`，移除所有硬编码 fallback 默认值
2. **replacePlaceholders()**：占位符字段值为空字符串时，跳过不替换，保留模板占位符原样
3. **签名日期处理**：源文档中没找到对应签名日期时，占位符保持原样不替换
4. **fillTableFromSource()**：源表格无数据行（sourceRows为空）时，直接返回原XML不修改
5. **fillBySubtreeCopy阶段2**：源表格无数据行时跳过该表格，不计入统计

## 技术方案

### 修改范围

本次改动仅限于后端3个服务文件，前端无需变动。

### 修改详情

#### 1. chapter-extractor.service.ts — extractBasicInfo() 移除 fallback 默认值

当前每个字段都有 fallback 默认值（如 `"GGW-0000-0000-2025"`、`"XXXXXXX公司"`），导致找不到数据时也用假数据填充。

**修改**：所有字段找不到时返回 `""`：

- `reportNumber`: `reportMatch ? reportMatch[0] : ""`
- `companyName`: `companyMatch ? companyMatch[1] + "公司" : ""`
- `deviceName`: `deviceMatch ? deviceMatch[1].trim() : ""` （移除 pipeLineName fallback）
- `reportTypePrefix`: `prefixMatch ? prefixMatch[1] : ""`
- `inspectionStartDate`: `dates.start || ""`
- `inspectionEndDate`: `dates.end || ""`
- `inspectorDate`: `dates.inspector || ""`
- `checkerDate`: `dates.checker || ""`
- `reviewerDate`: `dates.reviewer || ""`

#### 2. filler.service.ts — replacePlaceholders() 跳过空值

当前逻辑：`getValue(data)` 返回空字符串时走签名日期分支，用硬编码签名日期填充。

**修改**：

- PLACEHOLDER_MAP 中报告编号/设备名/公司名/前缀的 `getValue` 返回空字符串时 → 跳过不替换
- 签名日期占位符（`202X年X月XX日`）：从 `signatureDates` 数组中取非空值，若当前签名日期为空则跳过该占位符
- 多 run 联合替换：`reportNumber` 为空时跳过

核心改动点（`replacePlaceholders` 第304-327行）：

```
// 原有逻辑：getValue(data) 为 falsy 时走签名日期分支
// 新逻辑：getValue(data) 为 falsy 时直接跳过（不替换该占位符）
if (getValue(data)) {
  // 替换
} else {
  // 跳过，保持原样（不再走签名日期分支）
}
```

签名日期分支独立处理：只在签名日期占位符匹配且 signatureDates 有对应非空值时替换。

#### 3. xml-subtree-inserter.service.ts — fillTableFromSource() 空数据行保护

当前：sourceRows 为空时仍遍历模板行、可能修改表格。

**修改**：在第43行提取 sourceRows 后，立即检查：

```
if (sourceRows.length === 0) {
  return { xml: targetXml, rowsFilled: 0 };
}
```

#### 4. filler.service.ts — fillBySubtreeCopy 阶段2跳过空表格

当前：`fillTableFromSource` 即使 rowsFilled=0 也计入 stats.tablesFilled。

**修改**：检查 `fillResult.rowsFilled > 0` 才计入统计：

```
if (fillResult.rowsFilled > 0) {
  stats.tablesFilled++;
  stats.rowsInserted += fillResult.rowsFilled;
  xml = fillResult.xml;
} else {
  // 源表格无数据行，跳过不修改模板
}
```

### 文件改动清单

| 文件 | 改动 |
| --- | --- |
| `server/src/services/chapter-extractor.service.ts` | extractBasicInfo() 9个字段 fallback 值改为 `""` |
| `server/src/services/filler.service.ts` | replacePlaceholders() 空值跳过逻辑 + fillBySubtreeCopy 阶段2 rowsFilled>0 检查 |
| `server/src/services/xml-subtree-inserter.service.ts` | fillTableFromSource() sourceRows 为空时提前返回 |