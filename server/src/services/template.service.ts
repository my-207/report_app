import fs from "fs/promises";
import path from "path";
import { v4 as uuidv4 } from "uuid";
import { config } from "../config";
import { logger } from "../utils/logger";
import { docxService } from "./docx.service";
import { extractTagContent } from "../utils/xml-utils";
import {
  TemplateAnalysis,
  PlaceholderLocation,
  TableHeaderMatch,
} from "../types";

/** 模板管理服务：上传接收、解压缓存、占位符定位、表头提取 */
export class TemplateService {
  /** 模板缓存：sessionId → 解压目录路径、原始 XML 快照 */
  private cache: Map<string, {
    unpackDir: string;
    fileName: string;
    originalXml?: string;
    analysis?: TemplateAnalysis;
  }> = new Map();

  /** 保存上传的模板文件并解压 */
  async processUpload(fileBuffer: Buffer, originalName: string): Promise<{
    sessionId: string;
    fileName: string;
  }> {
    const sessionId = uuidv4();
    const uploadPath = path.join(config.uploadDir, `${sessionId}_${originalName}`);
    const unpackDir = path.join(config.sessionsDir, sessionId);

    // 保存原始文件
    await fs.writeFile(uploadPath, fileBuffer);

    // 解压到缓存目录
    await docxService.unpack(uploadPath, unpackDir);

    // 读取原始 document.xml 快照（用于后续格式校验）
    const docXmlPath = path.join(unpackDir, "word", "document.xml");
    let originalXml: string | undefined;
    try {
      originalXml = await fs.readFile(docXmlPath, "utf-8");
    } catch {
      logger.warn("无法读取原始 document.xml 快照");
    }

    // 缓存
    this.cache.set(sessionId, { unpackDir, fileName: originalName, originalXml });
    logger.info(`模板已缓存: ${sessionId} (${originalName})`);

    return { sessionId, fileName: originalName };
  }

  /** 获取缓存的解压目录（含原始 XML 快照） */
  getSession(sessionId: string): {
    unpackDir: string;
    fileName: string;
    originalXml?: string;
  } | null {
    const entry = this.cache.get(sessionId);
    if (!entry) return null;
    return {
      unpackDir: entry.unpackDir,
      fileName: entry.fileName,
      originalXml: entry.originalXml,
    };
  }

  /** 分析模板：定位占位符和提取表头 */
  async analyzeTemplate(sessionId: string): Promise<TemplateAnalysis> {
    const entry = this.cache.get(sessionId);
    if (!entry) throw new Error(`会话 ${sessionId} 不存在`);

    // 如果已分析过，直接返回缓存
    if (entry.analysis) return entry.analysis;

    const xmlContent = await docxService.readDocumentXml(entry.unpackDir);

    const placeholders = this.findPlaceholders(xmlContent);
    const tables = this.extractTableHeaders(xmlContent);

    const analysis: TemplateAnalysis = { placeholders, tables };
    entry.analysis = analysis;
    this.cache.set(sessionId, entry);

    logger.info(
      `模板分析完成: ${placeholders.length} 个占位符, ${tables.length} 个表格`
    );

    return analysis;
  }

  /** 扫描 XML 中所有占位符 */
  private findPlaceholders(xml: string): PlaceholderLocation[] {
    const placeholders: PlaceholderLocation[] = [];

    // 提取所有 <w:t> 文本内容
    const wtRegex = /<w:t\b[^>]*>(.*?)<\/w:t>/g;
    let match: RegExpExecArray | null;

    const patterns: { regex: RegExp; mapTo: string }[] = [
      { regex: /[A-Z]*-X{3,}-X{3,}-20\dX/g, mapTo: "basicInfo.reportNumber" },
      { regex: /X{10,}(?!\/)/g, mapTo: "basicInfo.deviceName" },
      { regex: /X{6,}公司/g, mapTo: "basicInfo.companyName" },
      { regex: /X{4,}\/X{4,}\/X{4,}\/X{4,}/g, mapTo: "basicInfo.reportTypePrefix" },
      { regex: /20\dX年[\s\u3000]*[X\d]+月[\s\u3000]*-[\s\u3000]*20\dX年[\s\u3000]*[X\d]+月/g, mapTo: "inspectionDateRange" },
      { regex: /20\dX年[\dX]+月[\dX]+日/g, mapTo: "signatureDate" },
      { regex: /20XX年XX月XX日/g, mapTo: "signatureDateAlt" },
    ];

    while ((match = wtRegex.exec(xml)) !== null) {
      const text = match[1];
      for (const { regex, mapTo } of patterns) {
        const textMatch = text.match(regex);
        if (textMatch) {
          placeholders.push({
            pattern: regex.source,
            xmlFile: "word/document.xml",
            matchedText: textMatch[0],
            mapTo,
          });
          break; // 一个文本节点只匹配一个模式
        }
      }
    }

    return placeholders;
  }

  /** 提取所有表格的表头 */
  private extractTableHeaders(xml: string): TableHeaderMatch[] {
    const tables: TableHeaderMatch[] = [];
    let tableIndex = 0;

    // 使用正则扫描提取每个 <w:tbl ...>...</w:tbl>（标签通常带属性）
    const tblOpenRegex = /<w:tbl[ >]/g;
    let tblMatch: RegExpExecArray | null;

    while ((tblMatch = tblOpenRegex.exec(xml)) !== null) {
      const tblStart = tblMatch.index;

      // 找到对应的 </w:tbl>（精确配对，排除 <w:tblPr> 等子标签的干扰）
      const tblContent = extractTagContent(xml, tblStart, "w:tbl");
      if (!tblContent) continue;

      // 提取第一行（表头行）
      const trOpenRegex = /<w:tr[ >]/g;
      trOpenRegex.lastIndex = 0;
      const firstTrMatch = trOpenRegex.exec(tblContent);
      if (!firstTrMatch) continue;

      const firstTr = extractTagContent(tblContent, firstTrMatch.index, "w:tr");
      if (firstTr) {
        // 提取第一行中所有 <w:t> 的文本内容
        const headers: string[] = [];
        const wtRegex = /<w:t\b[^>]*>(.*?)<\/w:t>/g;
        let wtMatch: RegExpExecArray | null;
        while ((wtMatch = wtRegex.exec(firstTr)) !== null) {
          const text = wtMatch[1].trim();
          if (text && !text.startsWith("<") && text.length < 50) headers.push(text);
        }

        if (headers.length > 0) {
          tables.push({
            tableIndex,
            headers,
            tableName: `表格_${tableIndex + 1}`,
          });
        }
      }

      tableIndex++;
    }

    return tables;
  }

  /** 获取 document.xml 的原始内容 */
  async getDocumentXml(sessionId: string): Promise<string> {
    const entry = this.cache.get(sessionId);
    if (!entry) throw new Error(`会话 ${sessionId} 不存在`);
    return docxService.readDocumentXml(entry.unpackDir);
  }

  /** 写入修改后的 document.xml */
  async saveDocumentXml(sessionId: string, content: string): Promise<void> {
    const entry = this.cache.get(sessionId);
    if (!entry) throw new Error(`会话 ${sessionId} 不存在`);
    await docxService.writeDocumentXml(entry.unpackDir, content);
  }

  /** 获取解压目录路径 */
  getUnpackDir(sessionId: string): string | null {
    return this.cache.get(sessionId)?.unpackDir ?? null;
  }

  /** 清除会话缓存 */
  async clearSession(sessionId: string): Promise<void> {
    const entry = this.cache.get(sessionId);
    if (entry) {
      await docxService.cleanupDir(entry.unpackDir);
      this.cache.delete(sessionId);
    }
  }
}

export const templateService = new TemplateService();
