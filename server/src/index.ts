import express from "express";
import cors from "cors";
import path from "path";
import { config } from "./config";
import { logger } from "./utils/logger";
import { docxService } from "./services/docx.service";
import { taskService } from "./services/task.service";
import apiRoutes from "./routes/api";
import employeeRoutes from "./routes/employee";

const app = express();

// ---------- 中间件 ----------
app.use(cors());
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));

// 静态文件服务（前端页面）
app.use(express.static(path.join(config.rootDir, "..", "public")));

// 上传文件访问（用于调试）
app.use("/uploads", express.static(config.uploadDir));

// ---------- 路由注册 ----------
app.use("/api", apiRoutes);
app.use("/api", employeeRoutes);

// ---------- 首页 ----------
app.get("/", (_req, res) => {
  res.sendFile(path.join(config.rootDir, "..", "public", "index.html"));
});

// ---------- 全局错误处理 ----------
app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  logger.error(`未处理的错误: ${err.message}`);
  res.status(500).json({
    success: false,
    error: err.message || "服务器内部错误",
  });
});

// ---------- 启动服务 ----------
app.listen(config.port, () => {
  logger.info("=".repeat(50));
  logger.info(`🚀 年度检查报告自动填充服务已启动`);
  logger.info(`📋 业务接口: http://localhost:${config.port}/api`);
  logger.info(`🏥 健康检查: http://localhost:${config.port}/api/health`);
  logger.info(`👤 员工信息: http://localhost:${config.port}/api/employee/info`);
  logger.info(`🌐 前端页面: http://localhost:${config.port}`);
  logger.info("=".repeat(50));

  // 启动定时清理
  docxService.startCleanupTimer();
  taskService.startCleanupTimer();
  logger.info(`⏱️ 定时清理已启动 (TTL: ${config.fileTTL / 1000}s)`);
});

export default app;
