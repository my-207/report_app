---
name: update-frontend-table-display-and-fill
overview: 根据 Python 端分析修复结果，同步更新 TypeScript 后端的嵌套KV表识别、前端表格结构展示、样例数据生成和报告合成功能。
---

## 用户需求

将 Python 端已完成的表格分析修复同步到 TypeScript 后端和前端，确保前后端对表格类型判断一致，样例数据正确，报告填充功能正常。

## 产品概述

当前系统的 Python 端已完成嵌套KV表识别修复（如 tbl_2 从列表表纠正为嵌套KV表），但 TypeScript 端和前端尚未同步这些修复。需要同步以下能力：

## 核心功能

1. **嵌套KV表二次验证**：在 `isKeyValueTable()` 中增加 vMerge 嵌套检测，Row0 初判为列表表头后扫描数据行特征，正确识别嵌套KV表
2. **嵌套KV表标记传递**：通过 `isNestedKvTable()` 外部查询函数和 `isNestedKv` 字段在各层传递嵌套标记
3. **嵌套KV表Key提取**：跳过 Row0 表头，排除类别标题行（4格+gridSpan>=4+无vMerge），取每行最后一个有意义文本作为Key
4. **标题提取增强**：回溯范围从2扩大到5，过滤占位符文本，支持 used_titles 去重
5. **前端展示适配**：模板结构渲染和章节预览中展示嵌套KV表的特殊标记和Key列表
6. **样例数据生成**：`generateSampleData()` 正确处理嵌套KV表，生成正确的 kvPairs
7. **API结构输出**：`/template/structure` 输出中包含 `isNestedKv` 标记

## 技术栈

- **后端**：Node.js + TypeScript (Express)，XML 正