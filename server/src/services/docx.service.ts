import AdmZip from "adm-zip";
import fs from "fs/promises";
import path from "path";
import { config } from "../config";
import { logger } from "../utils/logger";

/** docx 操作服务：纯 Node.js 实现 unpack/pack，无外部依赖 */
export class DocxService {
  /** 解压 docx 文件到临时目录（docx 本质是 zip） */
  async unpack(docxPath: string, outputDir: string): Promise<void> {
    await fs.mkdir(outputDir, { recursive: true });
    logger.info(`解压模板: ${path.basename(docxPath)}`);

    try {
      const zip = new AdmZip(docxPath);
      zip.extractAllTo(outputDir, true);
      logger.debug(`解压完成: ${outputDir}`);
    } catch (err: any) {
      throw new Error(`解压模板失败: ${err.message}`);
    }
  }

  /** 将 XML 目录打包为 docx（zip 压缩并重命名为 .docx） */
  async pack(sourceDir: string, outputPath: string): Promise<void> {
    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    logger.info(`打包报告: ${path.basename(outputPath)}`);

    try {
      const zip = new AdmZip();

      // 递归添加目录中所有文件到 zip 根
      await this.addDirToZip(zip, sourceDir, "");

      // 写入 zip 文件，然后重命名为 .docx
      const tempZip = outputPath.replace(/\.docx$/i, ".zip");
      zip.writeZip(tempZip);

      // 重命名为 .docx
      await fs.rename(tempZip, outputPath);
      logger.debug(`打包完成: ${outputPath}`);
    } catch (err: any) {
      throw new Error(`打包报告失败: ${err.message}`);
    }
  }

  /** 递归添加目录到 zip */
  private async addDirToZip(zip: AdmZip, dirPath: string, zipPrefix: string): Promise<void> {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      const zipPath = zipPrefix ? `${zipPrefix}/${entry.name}` : entry.name;

      if (entry.isDirectory()) {
        // 目录：添加空目录条目（zip 中需要显式目录）
        zip.addFile(`${zipPath}/`, Buffer.alloc(0));
        await this.addDirToZip(zip, fullPath, zipPath);
      } else if (entry.isFile()) {
        const content = await fs.readFile(fullPath);
        zip.addFile(zipPath, content);
      }
    }
  }

  /** 读取 document.xml 内容 */
  async readDocumentXml(unpackDir: string): Promise<string> {
    const xmlPath = path.join(unpackDir, "word", "document.xml");
    return fs.readFile(xmlPath, "utf-8");
  }

  /** 写入 document.xml 内容 */
  async writeDocumentXml(unpackDir: string, content: string): Promise<void> {
    const xmlPath = path.join(unpackDir, "word", "document.xml");
    await fs.writeFile(xmlPath, content, "utf-8");
  }

  /** 清理临时目录 */
  async cleanupDir(dirPath: string): Promise<void> {
    try {
      await fs.rm(dirPath, { recursive: true, force: true });
    } catch {
      logger.warn(`清理目录失败: ${dirPath}`);
    }
  }

  /** TTL 自动清理过期文件 */
  startCleanupTimer(): NodeJS.Timer {
    return setInterval(async () => {
      const now = Date.now();
      const dirs = [config.uploadDir, config.outputDir, config.sessionsDir];

      for (const dir of dirs) {
        try {
          const entries = await fs.readdir(dir, { withFileTypes: true });
          for (const entry of entries) {
            if (entry.name === ".gitkeep") continue;
            const fullPath = path.join(dir, entry.name);
            try {
              const stat = await fs.stat(fullPath);
              if (now - stat.mtimeMs > config.fileTTL) {
                await fs.rm(fullPath, { recursive: true, force: true });
                logger.debug(`清理过期文件: ${entry.name}`);
              }
            } catch {
              // 跳过无法访问的文件
            }
          }
        } catch {
          // 目录可能不存在
        }
      }
    }, config.cleanupInterval);
  }
}

export const docxService = new DocxService();
