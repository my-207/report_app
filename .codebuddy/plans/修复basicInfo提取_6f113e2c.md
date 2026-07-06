---
name: 修复basicInfo提取
overview: 修复 chapterExtractor.extractBasicInfo 使其能从源文档中提取真实数据，修复占位符替换使其正确工作。
todos:
  - id: fix-report-number
    content: 修复 extractBasicInfo 中报告编号正则，放宽为 /[A-Z]{2,}-\d+-\d+-20\d{2}/
    status: completed
  - id: fix-company-name
    content: 修复公司名称正则，放宽中文长度限制为 {2,20}
    status: completed
  - id: fix-device-name
    content: 修复设备名称正则，添加管线名称、设备名称等备用匹配
    status: completed
  - id: fix-dates
    content: 修复 extractDates 起止日期逻辑，优先匹配明确日期范围，回退取最早最晚完整日期
    status: completed
  - id: compile-verify
    content: 编译验证，确保零 linter 错误
    status: completed
    dependencies:
      - fix-report-number
      - fix-company-name
      - fix-device-name
      - fix-dates
---

## 用户需求

源文档（原始MD.docx）是已填好的完整报告。系统需从中提取 basicInfo（报告编号、公司名、设备名、日期等）→ 填入模板占位符 → 输出与模板格式一致的报告。

## 当前问题

`extractBasicInfo()` 返回的 basicInfo 几乎全为空（reportNumber: ""、companyName: ""、reportTypePrefix: ""等），导致 `replacePlaceholders` 只替换了 1 个占位符（仅 deviceName 有值），模板中其他 X 占位符未被替换。

## 核心功能

1. 修复报告编号提取：放宽正则，支持源文档中的真实编号格式
2. 修复公司名称提取：放宽中文长度限制
3. 修复日期范围提取：更准确的起止日期逻辑
4. 修复设备名称提取：匹配源文档中的实际字段名

## 技术方案

### 修改文件：`server/src/services/chapter-extractor.service.ts`

#### 1. 报告编号正则放宽（第156行）

**当前代码**：

```typescript
const reportMatch = allText.match(/[A-Z]{3,5}-\d{4}-\d{4}-20\d{2}/);
```

**问题**：`{3,5}` 限制了字母前缀长度，`\d{4}-\d{4}` 要求两段数字，而源文档中可能如 `GGW-2024-03001-2024`（包含更多段或更长的数字段）。

**修复方案**：放宽为通用模式，匹配常见的报告编号格式（字母-数字-数字-年份），同时保留容错：

```typescript
// 放宽：不限字母长度，不限数字段位数
const reportMatch = allText.match(/[A-Z]{2,}-\d+-\d+-20\d{2}/);
```

#### 2. 公司名称正则放宽（第160行）

**当前代码**：

```typescript
const companyMatch = allText.match(/([\u4e00-\u9fa5]{2,10})公司/);
```

**问题**：`{2,10}` 限制了公司名字长度。

**修复方案**：

```typescript
const companyMatch = allText.match(/([\u4e00-\u9fa5]{2,20})公司/);
```

#### 3. 设备名称提取增强（第164行）

**当前代码**：

```typescript
const deviceMatch = allText.match(/管道名称[：:]\s*([^\n]+)/);
```

**修复方案**：添加备用匹配模式（管线名称、设备名称等）：

```typescript
const deviceMatch = allText.match(/(?:管道名称|管线名称|设备名称)[：:]\s*([^\n]+)/);
```

#### 4. 日期提取修复（第188-223行）

**当前问题**：`monthDates` 取第一个和最后一个月份，在文档中有跨年日期时可能不准。

**修复方案**：按日期类型分离——检验起始日期取最早完整日期（包含检验/检查上下文的日期），检验结束日期取最晚完整日期：

```typescript
// 起止日期：在文本中查找明确的"检验日期"或"检查日期"范围
const rangeMatch = text.match(/(\d{4}年\d{1,2}月\d{1,2}日)\s*[至到\-]\s*(\d{4}年\d{1,2}月\d{1,2}日)/);
if (rangeMatch) {
  result.start = rangeMatch[1];
  result.end = rangeMatch[2];
} else {
  // 回退：取最早和最晚的完整日期
  if (allDates.length >= 2) {
    result.start = allDates[0];
    result.end = allDates[allDates.length - 1];
  }
}
```

### 不修改的文件

- `filler.service.ts` 的 `replacePlaceholders`：`if (value)` 检查是正确保护逻辑，basicInfo 提取修复后自然生效
- `xml-utils.ts` 的 `extractAllTexts`：已有 `t.length < 200` 过滤，无需修改

### 验证方案

修改后重启服务，上传源文档查看 preview 面板的 basicInfo 字段是否全部有值。