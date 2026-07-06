---
name: format-preservation-fix
overview: 修复 insertTextAfterAnchor 在模板中新增 w:p 段落的问题，改为直接替换锚点段落内的 w:t 文本（保留模板原有段落结构不变）。
todos:
  - id: rewrite-insert-method
    content: 重写 insertTextAfterAnchor 方法：将"新增段落"改为"替换锚点段落中最后一个 w:t 的文本"，删除 buildSimpleParagraph 方法
    status: pending
  - id: compile-verify
    content: 编译验证，确保零 linter 错误，确认 buildSimpleParagraph 无其他引用
    status: pending
    dependencies:
      - rewrite-insert-method
---

## 用户需求

核心原则：填充模板文件时，格式不要有任何变化，只补充数据内容。

## 问题

`xml-subtree-inserter.service.ts` 中的 `insertTextAfterAnchor` 方法当前实现为：找到锚点段落后，提取其格式属性，用 `buildSimpleParagraph` 构建一个**全新的 `<w:p>` 段落**，插入到锚点段落之后。这导致模板段落数量增加，违反了"格式不变"原则。

## 修复目标

将 `insertTextAfterAnchor` 改为：找到锚点段落 → **直接替换该段落内某个 `<w:t>` 的文本**为签名文本。段落数量不变，所有格式标签完全保留，只修改文本内容。

## 技术方案

### 修改策略

将 `insertTextAfterAnchor` 从"新增段落"模式改为"替换文本"模式，同时删除不再需要的 `buildSimpleParagraph` 私有方法。

### 具体实现

#### 1. 重写 `insertTextAfterAnchor`（xml-subtree-inserter.service.ts 第188-234行）

**当前逻辑**（违反格式不变原则）：

```
找到锚点段落 → 提取 <w:pPr> 和 <w:rPr> → buildSimpleParagraph 构建新 <w:p> → 插入到锚点段落之后
```

**新逻辑**（只替换文本）：

```
找到锚点段落 → 在该段落内找到最后一个 <w:t> 元素 → 将其文本替换为 sourceText → 返回修改后的 XML
```

具体步骤：

1. 在 `targetXml` 中查找包含 `anchorText` 的 `<w:t>` 元素（保持现有逻辑）
2. 定位该 `<w:t>` 所在的 `<w:p>` 段落（保持现有逻辑）
3. 在该段落中查找最后一个 `<w:t>` 元素（通常锚点段落中最后一个 `<w:t>` 是占位符或空文本，适合填入签名内容）
4. 将该 `<w:t>` 的文本替换为 `sourceText`
5. 返回修改后的完整 XML

关键实现细节：

- 保留 `<w:t>` 的所有属性（如 `xml:space="preserve"`）
- 使用 `this.escapeXml(sourceText)` 对签名文本进行 XML 转义
- 复用已有的 `extractTagContent` 工具函数定位段落

#### 2. 删除 `buildSimpleParagraph`（第237-247行）

该方法仅被 `insertTextAfterAnchor` 调用，重写后不再需要。删除该私有方法和相关的 import（如果有单独引用的话）。

#### 3. `filler.service.ts` 调用处（第168-175行）

无需修改。`insertTextAfterAnchor` 的方法签名保持不变，调用方代码不受影响。

### 涉及文件

| 文件 | 修改内容 |
| --- | --- |
| `server/src/services/xml-subtree-inserter.service.ts` | 重写 `insertTextAfterAnchor` 方法（第188-234行），删除 `buildSimpleParagraph` 方法（第237-247行） |
| `server/src/services/filler.service.ts` | 无需修改 |


### 性能影响

- 新逻辑比旧逻辑更轻量：不再构建新的 XML 元素字符串，只是字符串级别的文本替换
- 时间复杂度：O(n) — 遍历一次 XML 查找锚点，再做一次段落内文本替换
- 无新增内存分配（除替换后的 XML 字符串本身）