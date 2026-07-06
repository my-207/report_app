---
name: create-codebuddy-doc
overview: 为报告生成项目创建 CODEBUDDY.md 文件，基于已有的架构计划和设计文档，指导未来的 AI 助手高效操作此仓库。
todos:
  - id: read-plan-doc
    content: 读取计划文档获取完整的架构信息和技术细节
    status: completed
  - id: check-existing-files
    content: 检查是否已存在 AGENTS.md/CODEBUDDY.md 等文件
    status: completed
  - id: create-codebuddy-md
    content: 使用 [skill:technical-writer] 创建 CODEBUDDY.md 文件
    status: completed
    dependencies:
      - read-plan-doc
      - check-existing-files
---

在工作区 `c:/Users/Administrator/CodeBuddy/报告生成/` 创建 `CODEBUDDY.md` 文件，供未来的 CodeBuddy 实例在操作此仓库时使用。

## 内容要求

1. **常用命令**：构建、运行、测试等开发常用命令，每条描述不超过 100 字
2. **高层架构描述**：整体架构和代码结构，不超过 1600 字，聚焦需要跨多个文件理解的大局观

## 约束

- 先检查是否已存在 AGENTS.md 或 CODEBUDDY.md，不存在则创建 CODEBUDDY.md
- 不包含显而易见的通用开发实践
- 不逐一列举可从文件树直接发现的每个组件
- 文件必须以 `# CODEBUDDY.md This file provides guidance to CodeBuddy when working with code in this repository.` 开头

## 技术方案

### 方案概述

直接在工作区根目录创建 `CODEBUDDY.md` 文件。根据现有的计划文档（`.codebuddy/plans/docx-template-filler_2dc86961(未完成).md`）中描述的完整项目架构、目录结构、数据流和技术决策来撰写文档内容。

### 关键决策

- **使用 [skill:technical-writer]** 指导文档撰写，确保专业性、结构清晰和内容完整
- 文档内容完全基于现有的计划文档提取，不编造项目信息
- 采用 Markdown 格式，与 CodeBuddy 读取规范兼容

### 内容规划

#### 常用命令部分

从计划中提取以下命令信息（由于项目尚未实施，基于规划推断）：

- `npm run dev` — 启动开发服务器（TypeScript 热重载）
- `npm run build` — 编译 TypeScript 为 JavaScript
- `npm start` — 启动生产服务
- `scripts/setup.bat` — 一键安装依赖
- 前端为纯静态文件，无构建步骤

#### 高层架构描述

基于计划文档提取：

1. **整体架构**：用户浏览器 -> Express 服务器 -> Python unpack -> XML 处理 -> Python pack -> 下载
2. **目录结构**：server/（后端服务）、public/（前端静态文件）、scripts/（工具脚本）
3. **数据流**：文件上传（multer）-> Excel 解析（xlsx 库）-> 模板解压（Python unpack）-> 文本替换 + 表格填充 -> 重新打包（Python pack）-> 文件下载
4. **核心类型定义**：ReportData、PlaceholderMapping、FillResult
5. **关键决策**：XML 直接操作（而非 docx-js 重建）以保留 WPS 模板格式
6. **服务模块职责**：template.service、excel.service、filler.service、docx.service

### 执行步骤

1. 读取计划文档获取完整架构信息
2. 使用 [skill:technical-writer] 指导 CODEBUDDY.md 的撰写
3. 创建 CODEBUDDY.md 文件（等待用户确认计划后执行）

## 使用的 Agent 扩展

### Skill

- **technical-writer**: 指导创建清晰、专业的开发者文档，确保 CODEBUDDY.md 的结构合理、内容准确、语言专业。使用该 skill 来规划文档结构、撰写内容并检查文档完整性。
- 预期产出：高质量的 CODEBUDDY.md 文件，包含常用命令和架构描述两大核心内容。