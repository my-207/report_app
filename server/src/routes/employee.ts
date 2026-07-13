import { Router, Request, Response } from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import { config } from "../config";
import { templateService } from "../services/template.service";
import { taskService } from "../services/task.service";
import {
  ApiResponse,
  HealthStatus,
  EmployeeInfo,
  TaskInfo,
  TaskExecuteRequest,
} from "../types";

const router = Router();

// ---------- 健康检查 ----------
router.get("/health", (_req: Request, res: Response) => {
  const memUsage = process.memoryUsage();
  const health: HealthStatus = {
    status: "healthy",
    uptime: process.uptime(),
    memoryUsage: {
      heapUsed: memUsage.heapUsed,
      heapTotal: memUsage.heapTotal,
    },
    activeTaskCount: taskService.getActiveCount(),
    completedTaskCount: taskService.getCompletedCount(),
    failedTaskCount: taskService.getFailedCount(),
  };

  res.json({
    success: true,
    data: health,
  } as ApiResponse<HealthStatus>);
});

// ---------- 员工信息 ----------
router.get("/employee/info", (_req: Request, res: Response) => {
  const info: EmployeeInfo = {
    ...config.employee,
    callbackUrl: config.webhookSecret ? "可配置" : undefined,
  };

  res.json({
    success: true,
    data: info,
  } as ApiResponse<EmployeeInfo>);
});

// ---------- 任务执行（异步） ----------
const taskUpload = multer({ dest: config.uploadDir, limits: { fileSize: config.maxFileSize } });

router.post("/task/execute", taskUpload.fields([
  { name: "template", maxCount: 1 },
  { name: "data", maxCount: 1 },
]), async (req: Request, res: Response) => {
  try {
    const files = req.files as { [fieldname: string]: Express.Multer.File[] };
    const templateFile = files?.template?.[0];
    const dataFile = files?.data?.[0];
    const body = req.body;

    let templateSessionId: string;
    let dataContent: string;
    let dataFormat: "json" | "yaml" = body.dataFormat || "json";

    // 处理模板
    if (templateFile) {
      const fileBuffer = fs.readFileSync(templateFile.path);
      const result = await templateService.processUpload(fileBuffer, templateFile.originalname);
      templateSessionId = result.sessionId;
    } else if (body.templateSessionId) {
      templateSessionId = body.templateSessionId;
    } else {
      return res.status(400).json({
        success: false,
        error: "缺少模板文件（template 字段或 templateSessionId 参数）",
      } as ApiResponse);
    }

    // 处理数据
    if (dataFile) {
      dataContent = fs.readFileSync(dataFile.path, "utf-8");
      const ext = path.extname(dataFile.originalname).toLowerCase();
      dataFormat = ext === ".yaml" || ext === ".yml" ? "yaml" : "json";
    } else if (body.data) {
      dataContent = typeof body.data === "string" ? body.data : JSON.stringify(body.data);
    } else {
      return res.status(400).json({
        success: false,
        error: "缺少数据内容（data 字段或数据文件）",
      } as ApiResponse);
    }

    // 创建并异步执行任务
    const request: TaskExecuteRequest = {
      data: dataContent,
      dataFormat,
      callbackUrl: body.callbackUrl,
    };

    const task = await taskService.executeTask(request, templateSessionId);

    res.json({
      success: true,
      data: {
        taskId: task.taskId,
        status: task.status,
        createdAt: task.createdAt,
      },
    } as ApiResponse);
  } catch (err: any) {
    res.status(500).json({
      success: false,
      error: `任务创建失败: ${err.message}`,
    } as ApiResponse);
  }
});

// ---------- 任务状态查询 ----------
router.get("/task/:taskId", (req: Request, res: Response) => {
  const { taskId } = req.params;
  const task = taskService.getTask(taskId);

  if (!task) {
    return res.status(404).json({
      success: false,
      error: `任务不存在: ${taskId}`,
    } as ApiResponse);
  }

  res.json({
    success: true,
    data: task,
  } as ApiResponse<TaskInfo>);
});

// ---------- 任务结果下载 ----------
router.get("/task/:taskId/download", (req: Request, res: Response) => {
  const { taskId } = req.params;
  const task = taskService.getTask(taskId);

  if (!task) {
    return res.status(404).json({
      success: false,
      error: "任务不存在",
    } as ApiResponse);
  }

  if (task.status !== "completed" || !task.result) {
    return res.status(400).json({
      success: false,
      error: `任务未完成，当前状态: ${task.status}`,
    } as ApiResponse);
  }

  const filePath = path.join(config.outputDir, task.result.outputFileName);

  res.download(filePath, task.result.outputFileName, (err) => {
    if (err) {
      res.status(404).json({
        success: false,
        error: "文件不存在或已被清理",
      } as ApiResponse);
    }
  });
});

export default router;
