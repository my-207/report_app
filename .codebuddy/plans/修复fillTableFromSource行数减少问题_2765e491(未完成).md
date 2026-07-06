---
name: 修复fillTableFromSource行数减少问题
overview: 修改 fillTableFromSource 的行组装逻辑：不强制缩减模板行数，改为逐行填充模式——数据够就填，数据不够保留空行，超出则追加。保证填充后行数≥填充前。
todos:
  - id: fix-row-count
    content: 修改 fillTableFromSource 数据行组装逻辑：逐个匹配模板空行填入数据，多余空行保留原样，不足时克隆追加
    status: pending
  - id: verify-compile
    content: 编译验证，确保零错误
    status: pending
    dependencies:
      - fix-row-count
---

## 问题描述

列表型表格填充后行数减少，触发格式校验错误。例如表格#9（填充前4行→填充后3行）、表格#12（填充前5行→填充后3行）。

## 根因

当前 `fillTableFromSource` 按 `表头 + N条数据行 + 签名行` 固定模式重建表格。模板原本有多个空数据行（如：表头 + 3个空数据行 + 签名行 = 5行），但源数据只有1条时，重建后仅3行，导致校验报错。

## 修复目标

确保填充后行数 >= 填充前行数。当源数据行数少于模板空数据行数时，保留模板多余空行不变（不丢弃）。

## 修改文件

`server/src/services/xml-subtree-inserter.service.ts` — 仅修改 `fillTableFromSource` 方法（第61-92行的组装逻辑）。

## 修改策略

将当前固定三段式组装：

```
表头 + N条数据行 + 签名行
```

改为动态匹配：

```
表头 + 数据行（逐个匹配模板空行填入）+ 签名行
```

### 具体逻辑

1. `headerRowXml = targetRows[0].xml` — 表头保留不变
2. `signatureTemplate = targetRows[last].xml` — 签名行保留不变
3. **数据行部分**（`targetRows[1]` ~ `targetRows[last-1]`，即中间所有行）：

- 获取模板中间行列表 `templateDataRows = targetRows.slice(1, -1)`
- 获取数据行模板格式 `dataRowTemplate = targetRows[1].xml`（第2行）
- 遍历源数据行 `dataRows`，逐个匹配模板中间行：
    - 如果源数据行索引 `i < templateDataRows.length`：用 `fillRowWithData(templateDataRows[i].xml, srcRow)` 填入该模板行
    - 如果源数据行索引 `i >= templateDataRows.length`：用 `fillRowWithData(dataRowTemplate, srcRow)` 克隆新行追加
- 如果模板中间行数多于源数据行数，多余的空行保留原样不变

4. 最终行数 = 1表头 + max(模板中间行数, 源数据行数) + 1签名行 >= 原模板行数

### 不变的部分

- `getTableWrapper` 保留 `w:tblPr` 和 `w:tblGrid` 的逻辑不变
- `extractTableDataRows` 签名行识别逻辑不变
- `extractAllRows`、`fillRowWithData` 等辅助方法不变
- 调用方 `filler.service.ts` 接口不变