import path from "path";
import { v4 as uuidv4 } from "uuid";
import { config } from "../config";
import { logger, logTask } from "../utils/logger";
import { docxService } from "./docx.service";
import { dataService } from "./data.service";
import { templateService } from "./template.service";
import { fillerService } from "./filler.service";
import { TaskInfo, TaskStatus, TaskExecuteRequest, FillResult, FillStats } from "../types";

/** 任务管理服务：状态机、异步执行、webhook 回调 */
export class TaskService {
  /** 任务存储（内存 Map） */
  private tasks: Map<string, TaskInfo> = new Map();

  /** 创建任务 */
  createTask(input?: { templateName: string; dataFileName: string; recordCount: number }): TaskInfo {
    const taskId = uuidv4();
    const now = new Date().toISOString();
    const task: TaskInfo = {
      taskId,
      status: "pending",
      createdAt: now,
      updatedAt: now,
      input,
    };
    this.tasks.set(taskId, task);
    logger.info(`任务已创建: ${taskId.slice(0, 8)}`);
    return task;
  }

  /** 获取任务 */
  getTask(taskId: string): TaskInfo | null {
    return this.tasks.get(taskId) ?? null;
  }

  /** 更新任务状态 */
  private updateTask(
    taskId: string,
    updates: Partial<Pick<TaskInfo, "status" | "result" | "error">>
  ): void {
    const task = this.tasks.get(taskId);
    if (!task) return;
    Object.assign(task, {
      ...updates,
      updatedAt: new Date().toISOString(),
    });
  }

  /** 异步执行填充任务（数字员工纳管接口） */
  async executeTask(
    request: TaskExecuteRequest,
    templateSessionId: string
  ): Promise<TaskInfo> {
    const task = this.createTask();
    const taskId = task.taskId;

    // 异步执行
    this.runTask(taskId, request, templateSessionId).catch((err) => {
      logger.error(`任务 ${taskId.slice(0, 8)} 执行异常: ${err.message}`);
      this.updateTask(taskId, { status: "failed", error: err.message });
    });

    return task;
  }

  /** 任务执行核心逻辑 */
  private async runTask(
    taskId: string,
    request: TaskExecuteRequest,
    templateSessionId: string
  ): Promise<void> {
    logTask(taskId, "开始执行");
    this.updateTask(taskId, { status: "running" });

    try {
      // 1. 解析数据
      logTask(taskId, "解析数据");
      const format = request.dataFormat || "json";
      const reportData = dataService.parse(request.data, format);

      // 2. 分析模板
      logTask(taskId, "分析模板");
      const analysis = await templateService.analyzeTemplate(templateSessionId);

      // 3. 执行填充
      logTask(taskId, "执行填充");
      const fillResult = await fillerService.fill(templateSessionId, reportData);

      // 4. 打包生成 docx
      logTask(taskId, "打包报告");
      const unpackDir = templateService.getUnpackDir(templateSessionId);
      if (!unpackDir) throw new Error("模板会话已失效");

      const outputFileName = `报告_${reportData.basicInfo.reportNumber}_${taskId.slice(0, 8)}.docx`;
      const outputPath = path.join(config.outputDir, outputFileName);
      await docxService.pack(unpackDir, outputPath);

      // 5. 设置结果
      fillResult.outputFileName = outputFileName;
      fillResult.downloadUrl = `/api/task/${taskId}/download`;

      this.updateTask(taskId, {
        status: "completed",
        result: fillResult,
      });

      logTask(taskId, `完成: ${fillResult.stats.placeholdersReplaced} 占位符, ${fillResult.stats.tablesFilled} 表, ${fillResult.stats.rowsInserted} 行`);

      // 6. 发送 webhook 回调
      if (request.callbackUrl) {
        await this.sendWebhook(request.callbackUrl, taskId, "completed", fillResult);
      }
    } catch (err: any) {
      logTask(taskId, `失败: ${err.message}`);
      this.updateTask(taskId, { status: "failed", error: err.message });

      // 失败回调
      if (request.callbackUrl) {
        await this.sendWebhook(request.callbackUrl, taskId, "failed", undefined, err.message);
      }
    }
  }

  /** 发送 webhook 回调 */
  private async sendWebhook(
    url: string,
    taskId: string,
    status: TaskStatus,
    result?: FillResult,
    error?: string
  ): Promise<void> {
    try {
      const payload = {
        taskId,
        status,
        result: result || null,
        error: error || null,
        timestamp: new Date().toISOString(),
      };

      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(config.webhookSecret
            ? { "X-Webhook-Secret": config.webhookSecret }
            : {}),
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        logger.warn(`Webhook 回调失败: ${url} (${response.status})`);
      }
    } catch (err: any) {
      logger.warn(`Webhook 回调异常: ${url} - ${err.message}`);
    }
  }



  /** 获取活跃任务数 */
  getActiveCount(): number {
    let count = 0;
    for (const [, task] of this.tasks) {
      if (task.status === "pending" || task.status === "running") count++;
    }
    return count;
  }

  /** 获取已完成任务数 */
  getCompletedCount(): number {
    let count = 0;
    for (const [, task] of this.tasks) {
      if (task.status === "completed") count++;
    }
    return count;
  }

  /** 获取失败任务数 */
  getFailedCount(): number {
    let count = 0;
    for (const [, task] of this.tasks) {
      if (task.status === "failed") count++;
    }
    return count;
  }

  /** TTL 清理过期任务 */
  startCleanupTimer(): NodeJS.Timer {
    return setInterval(() => {
      const now = Date.now();
      for (const [taskId, task] of this.tasks) {
        if (task.status === "completed" || task.status === "failed") {
          const updated = new Date(task.updatedAt).getTime();
          if (now - updated > config.fileTTL) {
            this.tasks.delete(taskId);
            logger.debug(`清理过期任务: ${taskId.slice(0, 8)}`);
          }
        }
      }
    }, config.cleanupInterval);
  }
}

export const taskService = new TaskService();
