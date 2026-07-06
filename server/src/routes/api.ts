import { Router, Request, Response } from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import { config } from "../config";
import { templateService } from "../services/template.service";
import { dataService } from "../services/data.service";
import { taskService } from "../services/task.service";
import { docxService } from "../services/docx.service";
import { chapterExtractor } from "../services/chapter-extractor.service";
import { fillerService } from "../services/filler.service";
import { statementsParser } from "../services/statements-parser.service";
import { generateJsonTemplate, generateYamlTemplate, generateUnifiedJsonTemplate, generateUnifiedYamlTemplate } from "../utils/template-generator";
import { logger } from "../utils/logger";
import { v4 as uuidv4 } from "uuid";
import { ApiResponse, UploadResponse, DataPreview, SourceAnalysis, SubtreeCopyStats, BasicInfo, UnifiedReportData } from "../types";
import { dataMerger } from "../services/data-merger.service";
import { templateAnalyzer } from "../services/template-analyzer.service";

const router = Router();

// 配置文件上传（multer）
const upload = multer({
  dest: config.uploadDir,
  limits: { fileSize: config.maxFileSize },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const allowed = [".docx", ".json", ".yaml", ".yml", ".rj"];
    if (allowed.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error(`不支持的文件格式: ${ext}，允许: ${allowed.join(", ")}`));
    }
  },
});

// ---------- 模板上传 ----------
router.post("/upload-template", upload.single("template"), async (req: Request, res: Response) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        error: "请上传 .docx 模板文件",
      } as ApiResponse);
    }

    const { sessionId, fileName } = await templateService.processUpload(
      req.file.buffer || fs.readFileSync(req.file.path),
      req.file.originalname
    );

    const response: ApiResponse<UploadResponse> = {
      success: true,
      data: {
        fileId: sessionId,
        fileName,
        fileSize: req.file.size,
        sessionId,
      },
    };
    res.json(response);
  } catch (err: any) {
    res.status(500).json({
      success: false,
      error: `模板上传失败: ${err.message}`,
    } as ApiResponse);
  }
});

// ---------- 数据上传 ----------
router.post("/upload-data", upload.single("data"), async (req: Request, res: Response) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        error: "请上传 .json 或 .yaml 数据文件",
      } as ApiResponse);
    }

    const ext = path.extname(req.file.originalname).toLowerCase();
    const format = ext === ".yaml" || ext === ".yml" ? "yaml" : "json";

    const content = fs.readFileSync(req.file.path, "utf-8");
    const reportData = dataService.parse(content, format as "json" | "yaml");
    const preview = dataService.generatePreview(reportData);

    const response: ApiResponse<{ preview: DataPreview; format: string }> = {
      success: true,
      data: { preview, format },
    };
    res.json(response);
  } catch (err: any) {
    res.status(400).json({
      success: false,
      error: `数据解析失败: ${err.message}`,
    } as ApiResponse);
  }
});

// ---------- 执行填充（同步） ----------
router.post("/fill", async (req: Request, res: Response) => {
  try {
    const { sessionId, dataContent, dataFormat } = req.body;

    if (!sessionId) {
      return res.status(400).json({
        success: false,
        error: "缺少 sessionId 参数",
      } as ApiResponse);
    }

    if (!dataContent) {
      return res.status(400).json({
        success: false,
        error: "缺少 dataContent 参数",
      } as ApiResponse);
    }

    const result = await taskService.fillSync(
      sessionId,
      typeof dataContent === "string" ? dataContent : JSON.stringify(dataContent),
      dataFormat || "json"
    );

    const response: ApiResponse = {
      success: true,
      data: result,
    };
    res.json(response);
  } catch (err: any) {
    res.status(500).json({
      success: false,
      error: `填充失败: ${err.message}`,
    } as ApiResponse);
  }
});

// ---------- 下载报告 ----------
router.get("/download/:fileName", (req: Request, res: Response) => {
  const { fileName } = req.params;
  const filePath = path.join(config.outputDir, fileName);

  res.download(filePath, fileName, (err) => {
    if (err) {
      res.status(404).json({
        success: false,
        error: "文件不存在或已被清理",
      } as ApiResponse);
    }
  });
});

// ---------- 源文档上传（子树复制模式） ----------
/** 源文档 session 缓存 */
const sourceSessions: Map<string, { unpackDir?: string; analysis: SourceAnalysis; isRj?: boolean }> = new Map();

router.post("/upload-source", upload.single("source"), async (req: Request, res: Response) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        error: "请上传原始数据 .docx 文件",
      } as ApiResponse);
    }

    const sessionId = uuidv4();
    const uploadPath = path.join(config.uploadDir, `${sessionId}_source_${req.file.originalname}`);
    const unpackDir = path.join(config.sessionsDir, `source_${sessionId}`);

    // 保存并解压
    const buffer = req.file.buffer || fs.readFileSync(req.file.path);
    await fs.promises.writeFile(uploadPath, buffer);
    await docxService.unpack(uploadPath, unpackDir);

    // 分析源文档
    const analysis = await chapterExtractor.analyze(unpackDir);
    sourceSessions.set(sessionId, { unpackDir, analysis });

    res.json({
      success: true,
      data: {
        sessionId,
        fileName: req.file.originalname,
        analysis: {
          totalChapters: analysis.totalChapters,
          totalTables: analysis.totalTables,
          keyValueTableCount: analysis.keyValueTableCount,
          keyValuePairCount: analysis.keyValuePairCount,
          basicInfo: analysis.basicInfo,
          chapterIds: analysis.chapters.map(c => c.id),
          tablePreviews: analysis.tablePreviews,
        },
      },
    } as ApiResponse);
  } catch (err: any) {
    res.status(500).json({
      success: false,
      error: `源文档上传失败: ${err.message}`,
    } as ApiResponse);
  }
});

// ---------- .rj 知识图谱上传 ----------
router.post("/upload-rj", upload.single("rj"), async (req: Request, res: Response) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        error: "请上传 .rj 知识图谱数据文件",
      } as ApiResponse);
    }

    const sessionId = uuidv4();
    const content = fs.readFileSync(req.file.path, "utf-8");

    // 解析可选的 basicInfo 补充字段
    let basicInfoOverride: Partial<BasicInfo> | undefined;
    if (req.body.basicInfo) {
      try {
        basicInfoOverride = typeof req.body.basicInfo === "string"
          ? JSON.parse(req.body.basicInfo)
          : req.body.basicInfo;
      } catch {
        logger.warn("basicInfo JSON 解析失败，将忽略补充信息");
      }
    }

    // 解析 .rj 为 SourceAnalysis
    const analysis = statementsParser.parse(content, basicInfoOverride);
    sourceSessions.set(sessionId, { analysis, isRj: true });

    res.json({
      success: true,
      data: {
        sessionId,
        fileName: req.file.originalname,
        analysis: {
          totalChapters: analysis.totalChapters,
          totalTables: analysis.totalTables,
          keyValueTableCount: analysis.keyValueTableCount,
          keyValuePairCount: analysis.keyValuePairCount,
          basicInfo: analysis.basicInfo,
          chapterIds: analysis.chapters.map(c => c.id),
          tablePreviews: analysis.tablePreviews,
        },
      },
    } as ApiResponse);
  } catch (err: any) {
    res.status(400).json({
      success: false,
      error: `.rj 文件解析失败: ${err.message}`,
    } as ApiResponse);
  }
});

// ---------- 子树复制填充（双源模式） ----------
router.post("/fill-by-copy", async (req: Request, res: Response) => {
  try {
    const { templateSessionId, sourceSessionId, rjSessionId } = req.body;

    if (!templateSessionId) {
      return res.status(400).json({
        success: false,
        error: "缺少 templateSessionId 参数",
      } as ApiResponse);
    }

    if (!rjSessionId && !sourceSessionId) {
      return res.status(400).json({
        success: false,
        error: "至少需要提供 rjSessionId 或 sourceSessionId 之一",
      } as ApiResponse);
    }

    // 收集源分析数据
    const templateEntry = templateService.getSession(templateSessionId);
    if (!templateEntry) {
      return res.status(404).json({
        success: false,
        error: "模板会话不存在",
      } as ApiResponse);
    }

    // .rj 源分析
    let rjAnalysis: SourceAnalysis | null = null;
    if (rjSessionId) {
      const rjEntry = sourceSessions.get(rjSessionId);
      if (!rjEntry) {
        return res.status(404).json({
          success: false,
          error: ".rj 源数据会话不存在或已过期",
        } as ApiResponse);
      }
      rjAnalysis = rjEntry.analysis;
    }

    // MD 源分析
    let mdAnalysis: SourceAnalysis | null = null;
    if (sourceSessionId) {
      const mdEntry = sourceSessions.get(sourceSessionId);
      if (!mdEntry) {
        return res.status(404).json({
          success: false,
          error: "原始MD.docx 源数据会话不存在或已过期",
        } as ApiResponse);
      }
      mdAnalysis = mdEntry.analysis;
    }

    // 合并双源分析
    const mergedAnalysis = fillerService.mergeSourceAnalysis(rjAnalysis, mdAnalysis);

    const unpackDir = templateEntry.unpackDir;
    if (!unpackDir) {
      return res.status(500).json({
        success: false,
        error: "无法获取模板解压目录",
      } as ApiResponse);
    }

    const { fillResult, subtreeStats } = await fillerService.fillBySubtreeCopy(
      templateSessionId,
      unpackDir,
      mergedAnalysis
    );

    // 打包生成报告
    const outputFileName = `报告_${mergedAnalysis.basicInfo.reportNumber || mergedAnalysis.basicInfo.deviceName || 'output'}.docx`;
    const outputPath = path.join(config.outputDir, outputFileName);
    await docxService.pack(templateEntry.unpackDir, outputPath);

    fillResult.outputFileName = outputFileName;
    fillResult.downloadUrl = `/api/download/${outputFileName}`;

    res.json({
      success: true,
      data: {
        fillResult,
        subtreeStats,
      },
    } as ApiResponse);
  } catch (err: any) {
    res.status(500).json({
      success: false,
      error: `子树复制填充失败: ${err.message}`,
    } as ApiResponse);
  }
});

// ---------- 模板分析 ----------
router.get("/template/analysis/:sessionId", async (req: Request, res: Response) => {
  try {
    const { sessionId } = req.params;
    const analysis = await templateService.analyzeTemplate(sessionId);

    res.json({
      success: true,
      data: analysis,
    } as ApiResponse);
  } catch (err: any) {
    res.status(404).json({
      success: false,
      error: err.message,
    } as ApiResponse);
  }
});

// ---------- 模板数据结构A（基于 TemplateStructure 的完整结构描述） ----------
router.get("/template/structure/:sessionId", async (req: Request, res: Response) => {
  try {
    const { sessionId } = req.params;
    const structure = await templateAnalyzer.analyze(sessionId);

    // 构建纯数据层描述（无 XML，适合前端展示和下载）
    const desc = {
      _schema: "UnifiedReportData",
      _version: "1.0",
      basicInfo: structure.sections
        .filter(s => s.sectionId === "_placeholders")
        .flatMap(s => s.placeholderFields.map(f => ({
          fieldName: f.mapTo,
          placeholderPattern: f.pattern,
          description: fieldLabelMap[f.mapTo] || "",
        }))),
      sections: structure.sections
        .filter(s => s.sectionId !== "_placeholders")
        .map(s => {
          // 解码表格名称（sectionId 格式: "table_N|||标题" 或 "table_N"）
          const titleParts = s.sectionId.includes("|||")
            ? s.sectionId.split("|||", 2)
            : [s.sectionId, null];
          return {
          sectionId: s.sectionId,
          sectionTitle: titleParts[1] || null, // 解码后的表格名称
          tables: s.tables.map(t => {
            const base = {
              tableIndex: t.tableIndex,
              ...(s.signaturePosition ? { hasSignatureRow: true } : {}),
            };
            if (t.isHybrid) {
              // 混合表：同时输出 KV 键名和列表列名
              return {
                ...base,
                tableType: "HybridTable",
                isHybrid: true,
                hybridListHeaderRows: t.hybridListHeaderRows ?? 1,
                expectedKeys: t.kvKeys || [],
                expectedColumns: (t.columns || []).map(c => c.header),
              };
            } else if (t.isNestedKv) {
              return {
                ...base,
                tableType: "NestedKeyValueTable",
                isNestedKv: true,
                expectedKeys: t.kvKeys || [],
              };
            } else if (t.isKeyValue) {
              return {
                ...base,
                tableType: "KeyValueTable",
                expectedKeys: t.kvKeys || [],
              };
            } else {
              return {
                ...base,
                tableType: "DataTable",
                expectedColumns: (t.columns || []).map(c => c.header),
              };
            }
          }),
          ...(s.signatureFields && s.signatureFields.length > 0
            ? { signatureRow: { hasSignature: true, labels: s.signatureFields } }
            : {}),
        };
      }),
    };

    // 若请求下载（?download=1），返回 Content-Disposition 附件
    const isDownload = req.query.download === "1" || req.query.download === "true";
    if (isDownload) {
      const jsonStr = JSON.stringify(desc, null, 2);
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.setHeader("Content-Disposition", "attachment; filename=\"TemplateStructure.json\"");
      res.send(jsonStr);
    } else {
      res.json({
        success: true,
        data: desc,
      } as ApiResponse);
    }
  } catch (err: any) {
    res.status(500).json({
      success: false,
      error: `模板结构分析失败: ${err.message}`,
    } as ApiResponse);
  }
});

// ---------- 模板样例数据（基于 TemplateStructure 自动生成模拟 UnifiedReportData） ----------
router.get("/template/sample-data/:sessionId", async (req: Request, res: Response) => {
  try {
    const { sessionId } = req.params;
    const structure = await templateAnalyzer.analyze(sessionId);
    const sampleData = templateAnalyzer.generateSampleData(structure);

    const isDownload = req.query.download === "1" || req.query.download === "true";
    if (isDownload) {
      const jsonStr = JSON.stringify(sampleData, null, 2);
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.setHeader("Content-Disposition", "attachment; filename=\"SampleData.json\"");
      res.send(jsonStr);
    } else {
      res.json({
        success: true,
        data: sampleData,
      } as ApiResponse);
    }
  } catch (err: any) {
    res.status(500).json({
      success: false,
      error: `样例数据生成失败: ${err.message}`,
    } as ApiResponse);
  }
});

// ---------- 使用样例数据填充模板（直接传入 UnifiedReportData 调用 fillBySubtreeCopyV2） ----------
router.post("/fill-with-data", async (req: Request, res: Response) => {
  try {
    const { templateSessionId, unifiedData } = req.body;

    if (!templateSessionId) {
      return res.status(400).json({
        success: false,
        error: "缺少 templateSessionId 参数",
      } as ApiResponse);
    }

    if (!unifiedData || !unifiedData.basicInfo || !unifiedData.sections) {
      return res.status(400).json({
        success: false,
        error: "缺少 unifiedData 参数或格式不正确（需要 basicInfo + sections）",
      } as ApiResponse);
    }

    // 获取模板缓存
    const templateEntry = templateService.getSession(templateSessionId);
    if (!templateEntry) {
      return res.status(404).json({
        success: false,
        error: "模板会话不存在或已过期，请重新上传模板",
      } as ApiResponse);
    }

    if (!templateEntry.unpackDir) {
      return res.status(500).json({
        success: false,
        error: "无法获取模板解压目录",
      } as ApiResponse);
    }

    logger.info(`开始使用样例数据填充模板: sessionId=${templateSessionId}, sections=${unifiedData.sections.length}`);

    // 调用 V2 填充方法
    const { fillResult, subtreeStats } = await fillerService.fillBySubtreeCopyV2(
      templateSessionId,
      unifiedData as UnifiedReportData
    );

    // 打包生成报告
    const outputFileName = `报告_样例填充_${unifiedData.basicInfo.deviceName || unifiedData.basicInfo.reportNumber || 'output'}.docx`;
    const outputPath = path.join(config.outputDir, outputFileName);
    await docxService.pack(templateEntry.unpackDir, outputPath);

    fillResult.outputFileName = outputFileName;
    fillResult.downloadUrl = `/api/download/${outputFileName}`;

    logger.info(`样例数据填充完成: ${outputFileName}`);

    res.json({
      success: true,
      data: { fillResult, subtreeStats },
    } as ApiResponse);
  } catch (err: any) {
    logger.error(`样例数据填充失败: ${err.message}`);
    res.status(500).json({
      success: false,
      error: `样例数据填充失败: ${err.message}`,
    } as ApiResponse);
  }
});

/** BasicInfo 字段中文标签映射 */
const fieldLabelMap: Record<string, string> = {
  reportNumber: "报告编号",
  companyName: "公司名称",
  deviceName: "设备/管道名称",
  reportTypePrefix: "报告类型前缀",
  inspectionStartDate: "检测起始日期",
  inspectionEndDate: "检测结束日期",
  inspectorDate: "检测人日期",
  checkerDate: "校对人日期",
  reviewerDate: "审核人日期",
};

// ---------- 数据模板下载 ----------
router.get("/template/data/:format", (req: Request, res: Response) => {
  const { format } = req.params;
  const fmt = format.toLowerCase();
  const isUnified = req.query.unified === "1" || req.query.unified === "true";

  if (fmt === "json") {
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${isUnified ? 'UnifiedData' : '数据' }模板.json"`);
    res.send(isUnified ? generateUnifiedJsonTemplate() : generateJsonTemplate());
  } else if (fmt === "yaml" || fmt === "yml") {
    res.setHeader("Content-Type", "application/x-yaml; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${isUnified ? 'UnifiedData' : '数据' }模板.yaml"`);
    res.send(isUnified ? generateUnifiedYamlTemplate() : generateYamlTemplate());
  } else {
    res.status(400).json({
      success: false,
      error: `不支持的格式: ${format}，支持: json, yaml`,
    } as ApiResponse);
  }
});

// ---------- 统一数据预览（新API：返回 UnifiedReportData） ----------
router.post("/preview-data", async (req: Request, res: Response) => {
  try {
    const { rjSessionId, sourceSessionId } = req.body;

    let rjData: UnifiedReportData | null = null;
    let mdData: UnifiedReportData | null = null;

    if (rjSessionId) {
      const rjEntry = sourceSessions.get(rjSessionId);
      if (rjEntry) {
        rjData = statementsParser.convertToUnified(rjEntry.analysis);
      }
    }

    if (sourceSessionId) {
      const mdEntry = sourceSessions.get(sourceSessionId);
      if (mdEntry) {
        mdData = statementsParser.convertToUnified(mdEntry.analysis);
      }
    }

    const merged = dataMerger.merge(rjData, mdData);

    res.json({
      success: true,
      data: { unified: merged },
    } as ApiResponse);
  } catch (err: any) {
    res.status(500).json({
      success: false,
      error: `数据预览失败: ${err.message}`,
    } as ApiResponse);
  }
});

export default router;
