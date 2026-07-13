import { Router, Request, Response } from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import { config } from "../config";
import { templateService } from "../services/template.service";
import { taskService } from "../services/task.service";
import { docxService } from "../services/docx.service";
import { fillerService } from "../services/filler.service";
import { ApiResponse, UploadResponse } from "../types";

const router = Router();

// 配置文件上传（multer）
const upload = multer({
  dest: config.uploadDir,
  limits: { fileSize: config.maxFileSize },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const allowed = [".docx", ".json", ".yaml", ".yml"];
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




router.post("/fill-with-data", async (req: Request, res: Response) => {
  try {
    const { templateSessionId, unifiedData } = req.body;
    if (!templateSessionId || !unifiedData) {
      return res.status(400).json({ success: false, error: "缺少 templateSessionId 或 unifiedData" } as ApiResponse);
    }
    const result = await fillerService.fillBySubtreeCopyV2(templateSessionId, unifiedData);

    // 打包生成 .docx 文件
    const unpackDir = templateService.getUnpackDir(templateSessionId);
    if (!unpackDir) {
      throw new Error("模板会话已失效");
    }
    const reportNumber = unifiedData.basicInfo?.reportNumber || Date.now();
    const outputFileName = `报告_${reportNumber}.docx`;
    const outputPath = path.join(config.outputDir, outputFileName);
    await docxService.pack(unpackDir, outputPath);

    result.fillResult.outputFileName = outputFileName;
    result.fillResult.downloadUrl = `/api/download/${outputFileName}`;

    res.json({ success: true, data: result } as ApiResponse);
  } catch (err: any) {
    res.status(500).json({ success: false, error: `填充失败: ${err.message}` } as ApiResponse);
  }
});

export default router;
