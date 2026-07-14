/**
 * Python 填充服务 — 通过 CLI 调用 python_report_filler 完成 docx 填充
 *
 * 封装了 child_process.spawn 调用，将 UnifiedReportData 写入临时 JSON 文件，
 * 调用 `report-filler fill` CLI 命令，解析输出结果。
 */

import { spawn } from "child_process";
import fs from "fs/promises";
import path from "path";
import { config } from "../config";
import { logger } from "../utils/logger";
import { FillResult, FillStats, ValidationInfo } from "../types";

/** Python CLI 调用选项 */
interface PythonFillOptions {
  /** 模板 .docx 文件路径 */
  templatePath: string;
  /** 统一报告数据 */
  data: any;
  /** 输出 .docx 路径 */
  outputPath: string;
  /** 超时毫秒（默认 120s） */
  timeout?: number;
}

/**
 * 将 UnifiedReportData (camelCase) 转换为 Python CLI 兼容格式
 * Python CLI 的 _load_data 支持 camelCase + snake_case 两种格式
 */
function convertToPythonFormat(data: any): any {
  // Python CLI 的 _dict_to_unified_report 同时支持 camelCase 和 snake_case，
  // 所以直接传入原始数据即可
  return data;
}

/**
 * 解析 Python CLI 的输出，提取 FillResult
 *
 * CLI 输出格式示例：
 *   ✓ 填充成功
 *     输出文件: /path/to/output.docx
 *     占位符替换: 6
 *     表格填充: 3
 *     行/单元格插入: 15
 *     格式校验: ✓ 通过
 *     警告: 2 条
 *     ⚠ 警告信息
 *
 * 失败：
 *   ✗ 填充失败: 错误信息
 */
function parseCliOutput(stdout: string, stderr: string): FillResult {
  const output = stdout + "\n" + stderr;

  // 检查失败
  const failMatch = output.match(/[✗×]\s*填充失败[：:]\s*(.+)/);
  if (failMatch) {
    return {
      success: false,
      outputFileName: "",
      downloadUrl: "",
      stats: { placeholdersReplaced: 0, tablesFilled: 0, rowsInserted: 0 },
      warnings: [],
      error: failMatch[1].trim(),
    };
  }

  // 检查运行失败
  const runFailMatch = output.match(/运行失败[：:]\s*(.+)/);
  if (runFailMatch) {
    return {
      success: false,
      outputFileName: "",
      downloadUrl: "",
      stats: { placeholdersReplaced: 0, tablesFilled: 0, rowsInserted: 0 },
      warnings: [],
      error: runFailMatch[1].trim(),
    };
  }

  // 提取成功信息
  const stats: FillStats = {
    placeholdersReplaced: 0,
    tablesFilled: 0,
    rowsInserted: 0,
  };

  const phMatch = output.match(/占位符替换[：:]\s*(\d+)/);
  if (phMatch) stats.placeholdersReplaced = parseInt(phMatch[1], 10);

  const tblMatch = output.match(/表格填充[：:]\s*(\d+)/);
  if (tblMatch) stats.tablesFilled = parseInt(tblMatch[1], 10);

  const rowMatch = output.match(/行\/单元格插入[：:]\s*(\d+)/);
  if (rowMatch) stats.rowsInserted = parseInt(rowMatch[1], 10);

  // 提取校验信息
  let validation: ValidationInfo | undefined;
  const valPassMatch = output.match(/格式校验[：:]\s*[✓✔]\s*通过/);
  const valFailMatch = output.match(/格式校验[：:]\s*[✗×]\s*失败/);

  if (valPassMatch || valFailMatch) {
    validation = {
      passed: !!valPassMatch,
      errors: [],
      warnings: [],
    };
  }

  // 提取警告
  const warnings: string[] = [];
  const warnLines = output.match(/[⚠]\s*(.+)/g);
  if (warnLines) {
    for (const line of warnLines) {
      const w = line.replace(/^[⚠]\s*/, "").trim();
      if (w) warnings.push(w);
    }
  }

  // 检查是否成功
  const successMatch = output.match(/[✓✔]\s*填充成功/);

  return {
    success: !!successMatch,
    outputFileName: "",
    downloadUrl: "",
    stats,
    warnings,
    validation,
    error: successMatch ? undefined : "Python CLI 返回了意外输出",
  };
}

/**
 * 调用 Python report-filler CLI 执行填充
 *
 * 工作流程：
 * 1. 将 UnifiedReportData 写入临时 JSON 文件
 * 2. 调用 `report-filler fill --template ... --data ... --output ...`
 * 3. 解析 CLI 输出，返回 FillResult
 */
export async function fillWithPython(options: PythonFillOptions): Promise<FillResult> {
  const { templatePath, data, outputPath, timeout = 120_000 } = options;

  // 1. 将数据写入临时 JSON 文件
  const tmpDataPath = path.join(config.outputDir, `_tmp_data_${Date.now()}.json`);
  const pythonData = convertToPythonFormat(data);

  try {
    await fs.writeFile(tmpDataPath, JSON.stringify(pythonData, null, 2), "utf-8");
    logger.info(`临时数据文件已写入: ${tmpDataPath}`);

    // 2. 确定 CLI 入口
    // 使用 `python -m report_filler.cli` 作为备选方案
    const cliArgs = [
      "-m", "report_filler.cli",
      "fill",
      "--template", templatePath,
      "--data", tmpDataPath,
      "--output", outputPath,
    ];

    logger.info(`调用 Python CLI: ${config.pythonPath} ${cliArgs.join(" ")}`);

    // 3. 执行 Python CLI
    const result = await executePythonProcess(config.pythonPath, cliArgs, {
      cwd: config.pythonFillerDir,
      timeout,
    });

    // 4. 清理临时文件
    await fs.unlink(tmpDataPath).catch(() => {});

    // 5. 解析输出
    const fillResult = parseCliOutput(result.stdout, result.stderr);

    // 6. 设置输出文件名（成功时）
    if (fillResult.success) {
      const outputFileName = path.basename(outputPath);
      fillResult.outputFileName = outputFileName;
      fillResult.downloadUrl = `/api/download/${outputFileName}`;
    }

    return fillResult;

  } catch (err: any) {
    // 清理临时文件
    await fs.unlink(tmpDataPath).catch(() => {});
    logger.error(`Python 填充执行异常: ${err.message}`);

    return {
      success: false,
      outputFileName: "",
      downloadUrl: "",
      stats: { placeholdersReplaced: 0, tablesFilled: 0, rowsInserted: 0 },
      warnings: [],
      error: `Python 填充执行失败: ${err.message}`,
    };
  }
}

/** 执行 Python 进程并捕获输出 */
function executePythonProcess(
  pythonPath: string,
  args: string[],
  opts: { cwd: string; timeout: number }
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const proc = spawn(pythonPath, args, {
      cwd: opts.cwd,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });

    let stdout = "";
    let stderr = "";
    let settled = false;

    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        proc.kill();
        reject(new Error(`Python 进程超时 (${opts.timeout / 1000}s)`));
      }
    }, opts.timeout);

    proc.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf-8");
    });

    proc.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf-8");
    });

    proc.on("error", (err) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        reject(new Error(`无法启动 Python 进程: ${err.message}`));
      }
    });

    proc.on("close", (code) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);

        if (code === 0) {
          resolve({ stdout, stderr });
        } else {
          reject(
            new Error(
              `Python 进程退出码 ${code}${stderr ? `: ${stderr.trim()}` : ""}`
            )
          );
        }
      }
    });
  });
}

export const pythonFillerService = {
  fillWithPython,
};
