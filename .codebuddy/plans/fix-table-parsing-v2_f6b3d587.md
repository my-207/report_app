---
name: fix-table-parsing-v2
overview: 修复tbl_2(37行嵌套表)被误识别为列表表的问题：Row0含序号/备注等列表头关键词导致is_key_value_table返回False，但该表实际语义为KV结构(C3具体项目=KEY, C4+C5=VALUE)。同时修正extract_table_title_from_paragraphs返回的标题不准确导致表格定位混乱的问题。
design:
  architecture:
    framework: react
    component: shadcn
  fontSystem:
    fontFamily: PingFang SC
    heading:
      size: 24px
      weight: 600
    subheading:
      size: 18px
      weight: 500
    body:
      size: 14px
      weight: 400
  colorSystem:
    primary:
      - "#2563EB"
    background:
      - "#F8FAFC"
      - "#FFFFFF"
    text:
      - "#1E293B"
      - "#64748B"
    functional:
      - "#16A34A"
      - "#DC2626"
todos:
  - id: fix-title-extraction
    content: 修复 extract_table_title_from_paragraphs() 标题重复问题：增大回溯范围并跳过已使用的标题
    status: completed
  - id: fix-is-kv-nested-detection
    content: 增强 is_key_value_table()：在列表表头判定后增加vMerge嵌套二次验证，将tbl_2重新归类为KV表
    status: completed
  - id: add-nested-kv-extraction
    content: 新增 _extract_nested_kv_keys() 方法：从vMerge嵌套表中提取正确的kv_keys（C3列具体项目名）
    status: completed
    dependencies:
      - fix-is-kv-nested-detection
  - id: update-build-section
    content: 修改 _build_section()：支持嵌套KV表分支，调用新的key提取方法
    status: completed
    dependencies:
      - fix-is-kv-nested-detection
      - add-nested-kv-extraction
  - id: update-models
    content: TemplateTableInfo 增加 is_nested_kv 字段，支持嵌套表标记
    status: completed
  - id: test-and-verify
    content: 运行测试验证：tbl_1标题正确 + tbl_2识别为KV表且kv_keys包含19个具体项目 + 全部既有测试仍通过
    status: completed
    dependencies:
      - fix-title-extraction
      - fix-is-kv-nested-detection
      - add-nested-kv-extraction
      - update-build-section
      - update-models
---

## Product Overview

修复 Python 报告填充模块中两个表格的解析错误：

1. **年度检查报告附页 (tbl_1)**: 标题提取不准确，当前返回 "报告编号：..." 而非实际的表格标题
2. **(1-1)原始资料审查报告 (tbl_2)**: 表格类型识别错误 —— 当前被判定为列表表 (`is_kv=False`, headers=4列)，但实际是**键值对嵌套表**（37行，3层vMerge层级结构，每行的具体项目名为KEY，检查结果+备注为VALUE）

## Core Features

### 问题1：标题提取不准确

**现象**: tbl_0、tbl_1、tbl_2 三个连续表格的 `extract_table_title_from_paragraphs()` 均返回 `"报告编号：XXXXX-XXXX-XXXX-202X"`

**根因**: `max_prev_paras=2` 且向前搜索时，连续表格之间的前导段落相同（或都回溯到了同一个报告编号段落），导致标题重复/错位

**修复**: 改进标题提取逻辑——增大回溯范围 + 跳过已使用的标题 + 遇到前一个表格时继续向上搜索而非停止

### 问题2：tbl_2 类型误判（核心问题）

**现象**:

- 当前: `is_kv=False`, `headers=['序号', '检查项目及其内容', '检查结果', '备注']`
- 用户期望: `is_kv=True`，每行为一个KV对

**根因链路**:

```
is_key_value_table(tbl_2)
  → Row0 物理格数 = 4 (≥3分支)
  → non_empty = 4/4 = 100% (≥75% ✓)
  → has_kw = True ("序号"在_LIST_HEADER_KEYWORDS中) ✓
  → return False (第356-357行: 判定为列表表!)
```

**Row0 的确看起来像列表表头**，但数据行(Row1+)的结构完全不同：

- 数据行有 **6个物理格**（vs 表头4格）
- 大量 **vMerge 单元格**（C1大类vMerge, C2子类vMerge）
- C3列包含具体项目名（使用登记证、安全管理规章制度等）= **真正的KEY**
- C4(检查结果) + C5(备注) = **VALUE**

**修复**: 在 `is_key_value_table()` 的列表表头判定之后，增加**二次验证**——扫描数据行是否存在大量vMerge嵌套特征。若存在，则判定为**嵌套KV表**(nested_kv)，返回True或新类型标识。

### 问题3：嵌套表的KV Keys提取 + 最后几行识别错误

**当前**: 作为列表表处理，无法提取正确的kv_keys

**期望**: 只提取**具体检查项目行**的 C3 文本作为 kv_keys，排除：

- **类别标题行 (Section Header Rows)**: 只有4格, gridSpan=4, 无具体检查项
- **子类标签行**: 以 `(1)`, `(2)` 等开头的分组标签

**正确的 kv_keys (排除类别标题后)**:

```python
# Row 1-21 的标准数据行 (C3列):
['使用登记证', '安全管理规章制度与安全操作规则', '作业人员上岗持证情况',
 '定期检验报告', '设计和安装改造维修等施工竣工验收资料',
 '日常运行维护记录', '隐患排查治理记录', '改造、维修资料', '故障与事故记录',
 '管道位置', '管道埋深', '管道走向', '三桩一牌', '锚固礅', '围栏']

# Row 16-21 的5格行 (C2列, gs=3):
['(3)管道沿线防护带', '(4)跨越段', '(5)穿越段', 
 '(6)水工保护设施', '(7)地面泄漏情况', '(8)其他检查']

# Row 23-28 的5格行 (C2列, gs=3):
['(1)电绝缘装置', '(2)电连续性能', '(1)保护电位', 
 '(2)牺牲阳极输出电流、开路电位', '(3)管内电流', '(4)辅助阳极床和牺牲阳极接地电阻']

# Row 29-32 的6格行 (C3列, 无gs):
['保护率', '运行率', '排流效果', '阴极保护系统设备和排流设施']

# Row 33 的5格行 (C2列, gs=3):
['(6)管道沿线交流电压测试']
```

**需要排除的行 (不应作为kv_key)**:

| 行号 | 序号 | 文本 | 原因 |
| --- | --- | --- | --- |
| Row 22 | 24 | `3 防腐（保温）层检查` | **4格类别标题**, gs=4, 无具体检查项 |
| Row 34 | 37 | `6 壁厚测定` | **4格类别标题**, gs=4, 无具体检查项 |
| Row 35 | 38 | `7 地质条件调查` | **4格类别标题**, gs=4, 无具体检查项 |
| Row 36 | 39 | `8 安全保护装置检验` | **4格类别标题**, gs=4, 无具体检查项 |


### 问题3b：最后几行的结构特征

通过 XML 逐行逐列分析确认，tbl_2 有 **3种不同的行类型**：

```
类型A - 标准数据行 (6格):  Row 1-15, 29-32
  [序号] [大类vMerge] [子类vMerge] [具体项目gs=2] [(空)] [(空)]

类型B - 子类行 (5格):     Row 16-21, 23-28, 33
  [序号] [大类vMerge=c] [子类/具体项目gs=3] [(空)] [(空)]
  ↑ 注意: 当某大类下只有一个子类时, 子类和具体项目合并到同一格(gs=3)

类型C - 类别标题行 (4格): Row 22, 34-36  
  [序号] [大类名gs=4] [(空)] [(空)]
  ↑ 这是 Section Header! 不是检查项, 不应提取为key!
```

## Tech Stack

- **Python 3.10+** (现有项目)
- **lxml** (XML 解析，已在使用)
- **dataclasses** (数据模型，已在使用)

## Implementation Approach

### 策略总览

采用**渐进式增强**方案，最小化对现有代码的修改范围：

1. **`is_key_value_table()` 增强** —— 在现有列表表头判定后增加嵌套检测分支
2. **新增 `_extract_nested_kv_keys()`** —— 专门处理含vMerge的嵌套表
3. **`extract_table_title_from_paragraphs()` 修复** —— 解决连续表格标题重复问题
4. **`TemplateTableInfo` 模型微调** —— 增加 `is_nested_kv` 标记

### 关键技术决策

**决策1: 为何不改变 Row0 的列表表头判定？**

Row0 `[序号|检查项目及其内容|检查结果|备注]` 客观上就是列表表头格式。强行改变此判断会影响其他真正的列表表。正确做法是在此判断**之后**增加二次验证。

**决策2: 嵌套KV表的判定条件**

```
if (被初步判定为列表表) AND (数据行满足以下任一条件):
  条件A: 数据行物理格数 > Row0物理格数 (说明有展开的嵌套列)
  条件B: 数据行中 vMerge单元格占比 > 30% (典型的层级合并特征)
  条件C: 数据行中有 gridSpan>1 的非首格单元格 (子项跨列)
→ 重新分类为 NESTED_KV 表
```

**决策3: 嵌套表的Key提取策略**

对于 tbl_2 这类嵌套表，Key的位置不是固定的偶数位，而是**每行中第一个非vMerge、非空、非纯数字的文本单元格**（排除序号列C0和已合并的大类/子类列）。通过分析XML确认：C3列是稳定的"具体项目"列。

更通用的算法：

```
跳过Row0(表头)
对每个数据行:
  1. 跳过 vMerge=continue 的单元格
  2. 跳过纯数字文本(序号)
  3. 找到第一个有实际意义的文本 → 作为 KEY
  4. 记录其后续空单元格位置作为 VALUE
```

### 数据流变更

```
修改前:
  is_key_value_table() → False → _build_section() → 列表表分支 → headers=[4列扁平模型]

修改后:
  is_key_value_table() 
    → 初判 False (Row0像列表头)
    → 二次验证: 检测数据行 vMerge 特征
    → 发现嵌套模式 → 返回 True (带 nested_kv 标记)
  → _build_section() → KV表分支 
    → _extract_nested_kv_keys() → kv_keys=[19个具体项目]
```

## Implementation Notes

### 性能考虑

- 嵌套检测只额外扫描 3-5 行数据行，O(rows * cells) 可忽略
- vMerge 比例计算在已有的 `analyze_row_cells()` 结果上进行，无额外 XPath

### 向后兼容

- `is_key_value_table()` 返回值仍为 bool，不影响现有调用方
- 新增内部标记 `nested_kv_detected` 通过函数属性或额外返回值传递
- 对于非嵌套表的所有现有表格，行为完全不变

### Blast Radius Control

- 只修改 `xml_utils.py` 的 `is_key_value_table()` 函数内部（增加嵌套检测块）
- 只修改 `template_analyzer.py` 的 `_build_section()` 和新增 `_extract_nested_kv_keys()`
- 只修改 `xml_utils.py` 的 `extract_table_title_from_paragraphs()` 回溯逻辑
- 不改动 filler.py / validator.py / xml_subtree_inserter.py

## Architecture Design

### 模块依赖关系（修改部分）

```
xml_utils.py (修改)
├── is_key_value_table()      [增强: 嵌套检测]
├── extract_table_title_from_paragraphs()  [修复: 标题去重]
└── analyze_row_cells()        [不变]

template_analyzer.py (修改)
├── _build_section()           [增强: 嵌套KV分支]
├── _extract_nested_kv_keys()  [新增]
└── _extract_kv_keys_from_table()  [不变,用于简单KV表]

models.py (微调)
└── TemplateTableInfo          [增加 is_nested_kv 可选字段]
```

## Directory Structure

```
python_report_filler/src/report_filler/
├── xml_utils.py               # [MODIFY] is_key_value_table增加嵌套检测, 标题提取修复
├── template_analyzer.py       # [MODIFY] _build_section增加嵌套KV分支, 新增_extract_nested_kv_keys
└── models.py                  # [MODIFY] TemplateTableInfo增加is_nested_kv字段
```

## Key Code Structures

### 修改后的 is_key_value_table 伪代码

```python
def is_key_value_table(table: etree._Element) -> bool:
    # ... 现有逻辑不变 ...
    
    # === 新增: 第357行之后，嵌套KV二次验证 ===
    if not result and rows_to_check < len(rows):  # 初判为False但还有更多行
        # 检查数据行是否有嵌套特征
        nested_score = 0
        sample_rows = min(len(rows) - start_row_idx, 5)
        total_merge_cells = 0
        total_cells = 0
        
        for r in range(start_row_idx, start_row_idx + sample_rows):
            cells = row_cells(rows[r])
            total_cells += len(cells)
            for c in cells:
                vm = cell_vmerge_status(c)
                gs = cell_gridspan(c)
                if vm != "none":
                    total_merge_cells += 1
                if gs > 1 and cell_merged_text(c).strip():
                    nested_score += 2  # 有内容的跨列单元格
        
        # vMerge占比 > 25% 或有内容跨列 → 嵌套表
        if total_cells > 0 and (total_merge_cells / total_cells > 0.25 or nested_score >= 4):
            table.nested_kv_detected = True  # 标记为嵌套KV
            return True
    
    return result
```

### 新增 _extract_nested_kv_keys 伪代码

```python
def _extract_nested_kv_keys(self, rows: list) -> list[str]:
    """从嵌套KV表中提取所有Key标签
    
    核心逻辑:
    1. 跳过 Row0 (表头行)
    2. 识别并跳过"类别标题行" (Section Header Rows):
       - 只有4个物理格 (len(cells) <= 4)
       - C1 的 gridSpan >= 4 (合并了所有子列)
       - 无 vMerge 单元格
       - 这些是 "3 防腐层检查", "6 壁厚测定" 等大类标题, 不是检查项
    3. 对于有效数据行:
       - 6格行: C3 (index=3) 是具体项目名 → 作为 KEY
       - 5格行: C2 (index=2) 是子类/具体项目(gs=3) → 作为 KEY  
       - 排除 vMerge=continue 的单元格
       - 排除纯数字(序号)和已见过的key(去重)
    """
    keys = []
    seen = set()
    
    for row in rows[1:]:  # 跳过表头
        cells = row_cells(row)
        
        # === 检测类别标题行 (4格, gridSpan>=4, 无vMerge) ===
        if len(cells) <= 4:
            c1_gs = cell_gridspan(cells[1]) if len(cells) > 1 else 1
            has_vmerge = any(cell_vmerge_status(c) != "none" for c in cells)
            if c1_gs >= 4 and not has_vmerge:
                continue  # 跳过类别标题行!
        
        # === 从数据行提取KEY ===
        # 策略: 找到最后一个有实际文本的非空、非序号、非vMerge=continue的单元格
        candidate_key = None
        
        for ci, cell in enumerate(cells):
            vm = cell_vmerge_status(cell)
            text = cell_merged_text(cell).strip()
            
            if vm == "continue":
                continue
            if not text or text in ("(empty)", ""):
                continue
            if text.isdigit():  # 跳过序号列 C0
                continue
            
            # 记录最后一个有意义的文本作为候选key
            candidate_key = text
        
        if candidate_key and candidate_key not in seen:
            keys.append(candidate_key)
            seen.add(candidate_key)
    
    return keys
```

**关键改进点**:

- 增加 **类别标题行检测** (`len(cells)<=4 AND c1_gs>=4 AND no vMerge`)
- 使用 **最后一个有意义文本** 作为 key（而非第一个），避免把大类/子类标签当作key

本项目为后端 Python 模块，无前端 UI 变更。设计部分仅涉及数据模型的调整。

## Skill

- **docx**
- Purpose: 验证修复后的 docx 解包/打包兼容性，确保生成的 .docx 文件能被 Word 正常打开
- Expected outcome: 修复完成后端到端测试通过，输出文件可正常打开

## SubAgent

- **code-explorer**
- Purpose: 在实现前深入查看 TS 版 template-analyzer.service.ts 中对这两个特殊表格的处理逻辑，确保 Python 版的修复策略与 TS 版一致
- Expected outcome: 确认 TS 版如何区分列表表和嵌套KV表，避免遗漏边界条件