---
name: format-preservation-fix
overview: 重写 insertTextAfterAnchor 为替换文本模式：在锚点段落的 w:t 文本中，将锚点文本之后的内容替换为签名人名（如"检测："→"检测：张三"），模板段落结构不变。同时优化 extractSignature 提取纯人名。
todos:
  - id: rewrite-insert-method
    content: 重写 insertTextAfterAnchor：将"新增段落"改为"替换锚点所在 w:t 文本为 锚点+人名"，删除 buildSimpleParagraph
    status: completed
  - id: rewrite-extract-signature
    content: 重写 extractSignature：只提取纯人名（不含日期），支持检测/校对/审核/检查/审批五种角色
    status: completed
  - id: compile-verify
    content: 编译验证，确保零 linter 错误，确认 buildSimpleParagraph 无其他引用
    status: completed
    dependencies:
      - rewrite-insert-method
      - rewrite-extract-signature
---

## 用户需求

核心原则（已确认）：

1. 源文档有数据就填充，没有就保留模板原样
2. **填充的模板文件，格式不要有任何变化，只补充数据内容**
3. 数据行超出模板空行时，克隆模板最后一行追加到表格末尾

签名填充的具体需求：

- 模板中 `检测：202X年X月XX日` → 日期X替换为实际数字（已有 replacePlaceholders 处理）
- 模板中 `检测：` 后面填入从源文档获取的实际人名 → 变为 `检测：张三`
- 同样处理 `校对：`、`审核：`、`检查：`、`审批：`

## 核心修复点

1. **insertTextAfterAnchor 重写**：从"在锚点段落后新增 `<w:p>` 段落"改为"直接替换锚点所在 `<w:t>` 的文本为 '锚点+人名'"，模板段落数量不变，所有格式标签完全保留
2. **extractSignature 重写**：从"返回整行签名文本（含日期）"改为"只提取纯人名"
3. **删除 buildSimpleParagraph**：重写后不再需要构建新段落的逻辑

## 技术方案

### 修改1：重写 insertTextAfterAnchor（xml-subtree-inserter.service.ts 第182-247行）

**当前逻辑**（违反格式不变原则）：

```
找到锚点段落 → 提取 pPr 和 rPr → buildSimpleParagraph 构建新 w:p → 插入到锚点段落之后
```

**新逻辑**（只替换文本）：

```
找到锚点所在 w:t → 将其文本从 "检测：" 替换为 "检测：张三" → 段落结构完全不变
```

关键实现：

- 保留 `<w:t>` 的所有属性（如 `xml:space="preserve"`）
- 使用已有的 `this.escapeXml(sourceText)` 进行 XML 转义
- 复用已有的 `extractTagContent` 定位段落
- 方法签名不变：`insertTextAfterAnchor(targetXml, anchorText, sourceText): string`

同时删除 `buildSimpleParagraph` 私有方法（第237-247行），该方法仅被 `insertTextAfterAnchor` 调用。

### 修改2：重写 extractSignature（chapter-extractor.service.ts 第98-106行）

**当前实现**：

```typescript
for (const text of texts) {
  if (/检测.*日期|校对.*日期|审核.*日期/.test(text)) {
    return text;  // 返回 "检测：张三 2025年6月23日"
  }
}
```

**新实现**：只提取纯人名，不包含日期

```typescript
const patterns = [
  /检测[：:]\s*(.+?)(?:\s*\d{4}年|$)/,
  /校对[：:]\s*(.+?)(?:\s*\d{4}年|$)/,
  /审核[：:]\s*(.+?)(?:\s*\d{4}年|$)/,
  /检查[：:]\s*(.+?)(?:\s*\d{4}年|$)/,
  /审批[：:]\s*(.+?)(?:\s*\d{4}年|$)/,
];
```

按优先级匹配，提取第一个捕获组中的纯人名，返回空字符串如果找不到。

### 修改3：filler.service.ts 第168-175行

无需修改。`insertTextAfterAnchor` 的方法签名保持不变，调用方代码完全不受影响。

## 涉及文件

| 文件 | 修改内容 |
| --- | --- |
| `server/src/services/xml-subtree-inserter.service.ts` | 重写 `insertTextAfterAnchor`（第188-234行），删除 `buildSimpleParagraph`（第237-247行） |
| `server/src/services/chapter-extractor.service.ts` | 重写 `extractSignature`（第98-106行），只提取纯人名 |
| `server/src/services/filler.service.ts` | 无需修改 |


## 性能影响

- 新逻辑比旧逻辑更轻量：不再构建新的 XML 元素字符串，只是字符串级别的文本替换
- 时间复杂度 O(n)：遍历一次 XML 查找锚点，再做段落内文本替换
- 无新增内存分配