# CODEBUDDY.md This file provides guidance to CodeBuddy when working with code in this repository.

## Project Overview

A web-based **Annual Inspection Report Auto-Filler** — a digital employee product. Users upload a Word template (`.docx`) and a JSON/YAML data file, then the system automatically fills the data into the template and generates a downloadable Word report.

**Core value**: Eliminates manual document editing, significantly improving report generation efficiency. Designed as a standardized digital employee with full management API for integration with digital employee management systems.

## Common Commands

### Initial Setup
```bash
cd server
npm install
# or use the one-click setup script:
scripts/setup.bat
```

### Development
```bash
cd server
npm run dev        # Start dev server with TypeScript hot-reload (ts-node-dev)
npm run build      # Compile TypeScript to JavaScript (tsc)
npm start          # Start production server (node dist/index.js)
```

### Frontend
The frontend is pure static HTML/CSS/JS — no build step required. Served via Express at `http://localhost:3100`.

### Python Dependencies (for docx unpack/pack)
```bash
pip install python-docx   # or use the docx skill's bundled scripts
```

## High-Level Architecture

### System Architecture

```
User Browser / Management System (public/)
        │
        │  Upload: template.docx + data.json/.yaml
        ▼
Express Server (server/src/index.ts)  — Port 3100
        │
        ├─── multer (file upload middleware)
        │
        ├─── Data Parsing (server/src/services/data.service.ts)
        │     ├── JSON: JSON.parse
        │     ├── YAML: js-yaml
        │     └── Output: structured ReportData { basicInfo, tables[] }
        │
        ├─── Template Processing (server/src/services/docx.service.ts)
        │     ├── Python unpack.py → extract XML files from .docx
        │     ├── Fallback: PowerShell Expand-Archive (Windows)
        │     └── TTL auto-cleanup (1 hour)
        │
        ├─── XML Processing Engine (server/src/services/filler.service.ts)
        │     ├── Phase 1: Text placeholder replacement (regex match in document.xml)
        │     ├── Phase 2: Table row filling (header matching → fill empty cells)
        │     └── Multi-run joint replacement (for split report numbers)
        │
        ├─── Task Management (server/src/services/task.service.ts)
        │     ├── State machine: pending → running → completed/failed
        │     ├── Async execution with webhook callback
        │     └── Sync mode for direct browser interaction
        │
        ├─── Repack (Python pack.py / PowerShell Compress-Archive → generate new .docx)
        │
        └─── Download response
```

### Key Architectural Decision: XML Direct Manipulation

**Why not use `docx-js` (a pure JS docx builder)?**
- The template is a complex WPS-created document with 46 XML files, custom styles (`wpsCustomData` namespace), complex tables, sections, headers/footers
- Rebuilding with `docx-js` would lose original formatting, styles, and layout details
- **Solution**: Directly edit the underlying XML using Python `unpack`/`pack` toolchain (from the `docx` skill) with PowerShell fallback for Windows

### Data Flow

1. **Upload**: User uploads `.docx` template + `.json`/`.yaml` data via `public/index.html`
2. **Data Parse**: `data.service.ts` parses JSON/YAML → outputs `ReportData` with validation
3. **Template Unpack**: `docx.service.ts` calls Python `unpack.py` (or PowerShell fallback) → extracts `.docx` to XML files
4. **Fill Phase 1 (Text)**: Scan all `<w:t>` nodes in `document.xml`, replace placeholders (e.g., `XXXXX-XXXX-XXXX-202X` → actual report number)
5. **Fill Phase 2 (Table)**: Traverse `<w:tbl>` elements, match data tables by header row, fill data rows into empty `<w:tc>` cells (auto-append rows if data exceeds template rows)
6. **Repack**: `docx.service.ts` calls Python `pack.py` (or PowerShell fallback) → generates new `.docx`
7. **Download**: User downloads the filled report

### Directory Structure

```
报告生成/
├── server/                          # Backend service (Node.js + TypeScript)
│   ├── package.json                 # Dependencies: express, cors, multer, js-yaml, uuid
│   ├── tsconfig.json                # TypeScript compiler config
│   ├── src/
│   │   ├── index.ts                 # Express app entry, middleware, route registration, port 3100
│   │   ├── config.ts                # Global config: port, dirs, TTL, employee info, webhook secret
│   │   ├── routes/
│   │   │   ├── api.ts              # Business API: upload template, upload data, fill, download, template analysis, data template download
│   │   │   └── employee.ts         # Management API: health check, employee info, task execute/query/download
│   │   ├── services/
│   │   │   ├── template.service.ts # Template management: upload, unpack, cache, placeholder analysis, header extraction
│   │   │   ├── data.service.ts     # Data parsing: JSON/YAML parse, validation, preview generation
│   │   │   ├── filler.service.ts   # Fill engine: placeholder replacement + table row filling + multi-run replacement
│   │   │   ├── docx.service.ts     # docx operations: Python unpack/pack, PowerShell fallback, TTL cleanup
│   │   │   └── task.service.ts     # Task management: state machine, async execution, webhook callback, sync fill
│   │   ├── utils/
│   │   │   ├── template-generator.ts # Data template generator: JSON and YAML format templates
│   │   │   └── logger.ts            # Logging utility: console output with colors, task log
│   │   └── types/
│   │       └── index.ts             # Type definitions: ReportData, BasicInfo, TableData, TaskInfo, EmployeeInfo, HealthStatus, etc.
│   ├── uploads/                     # Temporary storage for uploaded files
│   ├── output/                      # Output directory for generated .docx files
│   └── sessions/                    # Template unpack cache (by session ID)
├── public/                         # Frontend static files (pure HTML/CSS/JS, no framework)
│   ├── index.html                   # Main page: nav bar, dual-card upload, data preview, progress animation, result display
│   ├── css/
│   │   └── style.css               # Styles: blue-white palette, card layout, animations, responsive
│   └── js/
│       ├── main.js                  # Main logic: page init, global state, fill flow, step indicator
│       ├── upload.js                # Upload module: drag-drop, file validation, toast notifications
│       ├── preview.js               # Preview module: JSON data preview, table overview rendering
│       └── api.js                   # API module: fetch wrapper, upload, fill, download functions
└── scripts/
    └── setup.bat                   # One-click setup: npm install + build
```

### Core Type Definitions (`server/src/types/index.ts`)

```typescript
// Report data
interface ReportData { basicInfo: BasicInfo; tables: TableData[]; }
interface BasicInfo {
  reportNumber, companyName, deviceName, reportTypePrefix: string;
  inspectionStartDate, inspectionEndDate: string;
  inspectorDate, checkerDate, reviewerDate: string;
}
interface TableData { tableName: string; headers: string[]; rows: string[][]; }

// Task management
type TaskStatus = "pending" | "running" | "completed" | "failed";
interface TaskInfo { taskId: string; status: TaskStatus; createdAt, updatedAt: string; result?: FillResult; error?: string; }
interface FillResult { success: boolean; outputFileName: string; downloadUrl: string; stats: FillStats; warnings: string[]; }

// Digital employee
interface EmployeeInfo { employeeId: string; employeeName: string; version: string; capabilities: string[]; supportedFormats: {...}; }
interface HealthStatus { status: "healthy"|"degraded"|"unhealthy"; uptime: number; memoryUsage: {...}; activeTaskCount: number; }
```

### Placeholder Mapping Table

| Placeholder Pattern | Maps To |
|---|---|
| `XXXXX-XXXX-XXXX-202X` | Report number |
| `XXXXXXXXXXXX` | Device name |
| `XXXXXXX公司` | Company name |
| `XXXXXXXXX/XXXXXXXX/XXXXX/XXXXXX` | Report type prefix |
| `202X年6月-202X年7月` | Inspection start + end date |
| `202X年X月XX日` | Inspector/checker/reviewer signature dates |

### API Routes

**Business API (`routes/api.ts`):**

| Method | Endpoint | Purpose |
|---|---|---|
| POST | `/api/upload-template` | Upload .docx template, returns sessionId |
| POST | `/api/upload-data` | Upload .json/.yaml data, returns preview |
| POST | `/api/fill` | Sync fill (sessionId + data) |
| GET | `/api/download/:fileName` | Download generated report |
| GET | `/api/template/analysis/:sessionId` | Get template placeholder/table analysis |
| GET | `/api/template/data/:format` | Download data template (json/yaml) |

**Management API (`routes/employee.ts`):**

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/api/health` | Health check (status, memory, task counts) |
| GET | `/api/employee/info` | Digital employee metadata |
| POST | `/api/task/execute` | Async task execution (for management system) |
| GET | `/api/task/:taskId` | Query task status |
| GET | `/api/task/:taskId/download` | Download task output |

### Frontend Page Structure

1. **Top Nav Bar** — "年度检查报告自动填充" + "数字员工" badge + JSON/YAML template download buttons
2. **Step Indicator** — 4 steps: upload → preview → fill → download
3. **Upload Area** — Dual-card layout with drag-drop, connected by "+" visual element
4. **Data Preview** — Basic info fields + table overview chips
5. **Action Buttons** — "提交任务" primary + "重置" secondary
6. **Progress Animation** — 3-step progress with pulse animation
7. **Result Area** — Success: stats + download button; Error: error detail

### Skills Used in This Project

- **docx** — Provides `unpack`/`pack` Python toolchain for extracting/packing `.docx` XML files
- **frontend-design** — Generates high-quality frontend page code (HTML/CSS/JS)
- **technical-writer** — Used to create this `CODEBUDDY.md` and other project documentation

### Important Notes for Future CodeBuddy Instances

1. **Always use XML direct manipulation** for Word document processing — do NOT switch to `docx-js` rebuilding approach
2. **Python scripts** for unpack/pack are provided by the `docx` skill — check `.codebuddy/skills/docx/` for the exact script paths. Fallback to PowerShell on Windows
3. **Template file caching** — After first upload, cache the unpacked XML in `sessions/` by session ID
4. **Data format** — JSON/YAML only, no Excel/xlsx. Data validated against `BasicInfo` 9 required fields
5. **Frontend is framework-free** — No React/Vue/Angular; all interactions use vanilla JS with Fetch API
6. **Port configuration** — Default backend port is `3100` (configurable via `PORT` env var)
7. **Digital employee** — This is a digital employee product with management API endpoints (`/api/health`, `/api/employee/info`, `/api/task/*`)
8. **Task state machine** — pending → running → completed/failed, with webhook callback on terminal states
9. **TTL cleanup** — Uploaded files and sessions auto-cleanup after 1 hour (configurable via `FILE_TTL` env var)
