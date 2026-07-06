import { SourceAnalysis, Chapter, BasicInfo, TablePreview, UnifiedReportData, SectionData, DataTable, KeyValuePair, SignatureBlock } from "../types";
import { logger } from "../utils/logger";
import {
  RJ_PROPERTY_LABELS,
  buildColumnOrder,
  DATA_RECORD_DETECT_ITEM_PROP,
  DATA_RECORD_DETECT_VALUE_PROP,
  DATA_RECORD_DETECT_DATE_PROP,
} from "../utils/rj-property-map";

/**
 * statements.rj 解析器 — 将 RDF/JSON-LD 知识图谱转为 SourceAnalysis
 *
 * 输入：JSON-LD 格式的知识图谱（statements.rj 文件内容）
 * 输出：SourceAnalysis（可被 fillBySubtreeCopy 消费）
 *
 * 字段映射依据：《年度检查报告本体 V1.0》中的数据属性定义，
 * 通过 ../utils/rj-property-map 集中维护。
 */

interface RdfValue {
  value: string;
  type: "uri" | "literal";
  datatype?: string;
  lang?: string;
}

interface RdfEntity {
  [property: string]: RdfValue[];
}

interface RdfGraph {
  [entityUri: string]: RdfEntity;
}

interface SectionInfo {
  id: string;
  title: string;
}

/** .rj 中会被提取为表格字段的属性前缀 */
const RJ_PROP_PREFIX = "http://example.org/report#";

export class StatementsParser {
  /**
   * 解析 .rj 文件内容为 UnifiedReportData（新统一数据结构）
   */
  parseToUnified(rjContent: string, basicInfoOverride?: Partial<BasicInfo>): UnifiedReportData {
    const oldResult = this.parse(rjContent, basicInfoOverride);
    return this.convertToUnified(oldResult);
  }

  /** 将旧 SourceAnalysis 转为 UnifiedReportData */
  convertToUnified(analysis: SourceAnalysis): UnifiedReportData {
    const sections: SectionData[] = [];
    for (const ch of analysis.chapters) {
      const dataTables: DataTable[] = [];
      for (const tblXml of ch.tables) {
        const dt = this.xmlToDataTable(tblXml, ch.id);
        if (dt) dataTables.push(dt);
      }
      sections.push({
        id: ch.id,
        title: ch.title,
        kvPairs: [],
        tables: dataTables,
        signature: this.emptySignature(),
      });
    }
    return { basicInfo: analysis.basicInfo, sections };
  }

  /** 将 buildTable 产出的简化 XML 转为 DataTable */
  private xmlToDataTable(tableXml: string, sectionId: string): DataTable | null {
    // 提取表头
    const trRegex = /<w:tr[ >]/;
    const trMatch = trRegex.exec(tableXml);
    if (!trMatch) return null;

    const firstTrMatch = /<w:tr[ >]/g;
    let firstTrIdx = 0;
    let m: RegExpExecArray | null;
    const allTrs: string[] = [];
    const extractTagContent2 = (xml: string, startPos: number, tagName: string): string | null => {
      const openPattern = new RegExp("<" + tagName + "[ >]", "g");
      const closeTag = "</" + tagName + ">";
      let depth = 1;
      let pos = xml.indexOf(">", startPos);
      if (pos === -1) return null;
      pos++;
      while (pos < xml.length - closeTag.length) {
        openPattern.lastIndex = pos;
        const no = openPattern.exec(xml);
        const nc = xml.indexOf(closeTag, pos);
        if (nc === -1) return null;
        if (no && no.index < nc) { depth++; pos = xml.indexOf(">", no.index)! + 1; }
        else { depth--; if (depth === 0) return xml.substring(startPos, nc + closeTag.length); pos = nc + closeTag.length; }
      }
      return null;
    };
    const allTrRegex = /<w:tr[ >]/g;
    while ((m = allTrRegex.exec(tableXml)) !== null) {
      const tr = extractTagContent2(tableXml, m.index, "w:tr");
      if (tr) allTrs.push(tr);
      firstTrIdx++;
    }

    if (allTrs.length < 2) return null;

    // 表头
    const headers: string[] = [];
    const headerTdRegex = /<w:t\b[^>]*>(.*?)<\/w:t>/g;
    let hm: RegExpExecArray | null;
    while ((hm = headerTdRegex.exec(allTrs[0])) !== null) {
      const t = hm[1].trim();
      if (t && !t.startsWith("<") && t.length < 50) headers.push(t);
    }

    // 数据行
    const rows: Record<string, string>[] = [];
    for (let r = 1; r < allTrs.length; r++) {
      const cells: string[] = [];
      const tdRegex2 = /<w:tc[ >]/g;
      let tm2: RegExpExecArray | null;
      while ((tm2 = tdRegex2.exec(allTrs[r])) !== null) {
        const tc = extractTagContent2(allTrs[r], tm2.index, "w:tc");
        if (tc) {
          const wtm = /<w:t\b[^>]*>(.*?)<\/w:t>/.exec(tc);
          cells.push(wtm ? wtm[1].trim() : "");
        }
      }
      const row: Record<string, string> = {};
      for (let c = 0; c < headers.length && c < cells.length; c++) {
        row[headers[c]] = cells[c];
      }
      rows.push(row);
    }

    return { tableType: sectionId, headers, rows };
  }

  private emptySignature(): SignatureBlock {
    return { inspectorName: "", inspectorDate: "", checkerName: "", checkerDate: "", reviewerName: "", reviewerDate: "" };
  }

  /** @deprecated 旧 parse 方法，内部方法体 */
  parse(rjContent: string, basicInfoOverride?: Partial<BasicInfo>): SourceAnalysis {
    logger.info("开始解析 statements.rj...");

    const graph: RdfGraph = JSON.parse(rjContent);
    const entityUris = Object.keys(graph);
    logger.info(`知识图谱包含 ${entityUris.length} 个实体`);

    // 1. 提取章节定义
    const sections = this.extractSections(graph);

    // 2. 按章节分组记录
    const recordsBySection = this.groupRecordsBySection(graph, sections);

    // 3. 组装 Chapter 列表
    const { chapters, tablePreviews } = this.buildChapters(sections, recordsBySection);

    // 4. 提取 BasicInfo
    const basicInfo = this.buildBasicInfo(graph, basicInfoOverride);

    const totalTables = chapters.reduce((sum, c) => sum + c.tables.length, 0);

    logger.info(
      `解析完成: ${chapters.length} 个章节, ${totalTables} 个表格`
    );

    return {
      chapters,
      basicInfo,
      totalChapters: chapters.length,
      totalTables,
      keyValueTableCount: 0,
      keyValuePairCount: 0,
      tablePreviews,
    };
  }

  /** 提取章节定义 */
  private extractSections(graph: RdfGraph): SectionInfo[] {
    const sections: SectionInfo[] = [];
    for (const [uri, entity] of Object.entries(graph)) {
      const type = this.getEntityType(entity);
      if (type === "ReportSection" || type === "ConclusionSection" || type === "AnnexSection") {
        const annexNum = this.getValue(entity["http://example.org/report#annexNum"]);
        const sectionTitle = this.getValue(entity["http://example.org/report#sectionTitle"]);
        if (annexNum) {
          sections.push({ id: annexNum, title: sectionTitle || annexNum });
        }
      }
    }
    // 去重（同一个 Section 可能有多个类型标注）
    const seen = new Set<string>();
    return sections.filter(s => {
      if (seen.has(s.id)) return false;
      seen.add(s.id);
      return true;
    }).sort((a, b) => a.id.localeCompare(b.id));
  }

  /** 按章节分组记录 */
  private groupRecordsBySection(
    graph: RdfGraph,
    sections: SectionInfo[]
  ): Map<string, Record<string, RdfEntity[]>> {
    // sectionId → entityType → records[]
    const grouped = new Map<string, Record<string, RdfEntity[]>>();

    // 初始化所有章节
    for (const section of sections) {
      grouped.set(section.id, {});
    }

    for (const [uri, entity] of Object.entries(graph)) {
      const type = this.getEntityType(entity);
      // 跳过章节自身
      if (["ReportSection", "ConclusionSection", "AnnexSection", "SoilSection", "Entity"].includes(type)) continue;
      if (!type) continue;

      const belongsTo = this.getUriValue(entity["http://example.org/report#belongsToSection"]);
      let sectionId: string | null = null;

      if (belongsTo) {
        sectionId = this.extractSectionId(belongsTo);
      }

      // 回退：使用 annexNum 作为章节 ID（GD_*/CR_* 等实体使用此属性）
      if (!sectionId) {
        const annexNum = this.getValue(entity["http://example.org/report#annexNum"]);
        if (annexNum && grouped.has(annexNum)) {
          sectionId = annexNum;
        }
      }

      if (!sectionId) continue;

      if (!grouped.has(sectionId)) {
        grouped.set(sectionId, {});
      }

      const typeMap = grouped.get(sectionId)!;
      if (!typeMap[type]) {
        typeMap[type] = [];
      }
      typeMap[type].push(entity);
    }

    return grouped;
  }

  /** 从 URI 提取章节编号（如 http://.../Section_3-2 → 3-2） */
  private extractSectionId(uri: string): string | null {
    const m = uri.match(/Section[_-](\d+[-_]\d+)/);
    if (!m) return null;
    return m[1].replace("_", "-");
  }

  /** 构建 Chapter 列表 */
  private buildChapters(
    sections: SectionInfo[],
    recordsBySection: Map<string, Record<string, RdfEntity[]>>
  ): { chapters: Chapter[]; tablePreviews: TablePreview[] } {
    const chapters: Chapter[] = [];
    const tablePreviews: TablePreview[] = [];

    for (const section of sections) {
      const typeMap = recordsBySection.get(section.id);
      const tables: string[] = [];

      if (typeMap) {
        for (const [entityType, records] of Object.entries(typeMap)) {
          if (records.length === 0) continue;

          const { tableXml, headers, sampleRows } = this.buildTable(entityType, records);
          tables.push(tableXml);

          logger.info(
            `  [章节 ${section.id}] ${entityType}: ${records.length} 条记录, 列: [${headers.join(", ")}]`
          );

          tablePreviews.push({
            sectionId: section.id,
            entityType,
            headers,
            rowCount: records.length,
            sampleRows,
          });
        }
      }

      chapters.push({
        id: section.id,
        title: section.title,
        startIndex: 0,
        endIndex: 0,
        xmlContent: tables.join(""),
        paragraphs: [],
        tables,
        signatureText: "", // .rj 中无签名信息
      });
    }

    return { chapters, tablePreviews };
  }

  /**
   * 构建单个表格（XML + 预览数据）
   * 表头根据实体类型推荐列和实际存在的属性动态生成。
   */
  private buildTable(
    entityType: string,
    records: RdfEntity[]
  ): { tableXml: string; headers: string[]; sampleRows: string[][] } {
    // 1. 提取每条记录的属性值映射
    const recordValues: Record<string, string>[] = [];
    for (let i = 0; i < records.length; i++) {
      const record = records[i];
      const rawSeq = this.getValue(record["http://example.org/report#seq"]);
      const seq = rawSeq && /^\d+$/.test(rawSeq) ? rawSeq : String(i + 1);
      const detectItem = rawSeq && !/^\d+$/.test(rawSeq) ? rawSeq : undefined;
      recordValues.push(this.extractRecordValues(entityType, record, seq, detectItem));
    }

    // 2. 计算属性并集，生成最终列顺序（属性名）和中文表头
    const propSets = recordValues.map(v => new Set(Object.keys(v)));
    const columnOrder = buildColumnOrder(entityType, propSets);
    const headers = columnOrder.map(prop => RJ_PROPERTY_LABELS[prop] || prop);

    // 3. 构建表头行
    const headerRow = this.buildWtr(
      headers.map(h => this.buildWtc(h)).join("")
    );

    // 4. 构建数据行
    const sampleRows: string[][] = [];
    const dataRows: string[] = [];
    for (const values of recordValues) {
      const cells = columnOrder.map(prop => values[prop] || "");
      sampleRows.push(cells);
      const rowCells = cells.map(c => this.buildWtc(c)).join("");
      dataRows.push(this.buildWtr(rowCells));
    }

    const tableXml = `<w:tbl>${headerRow}${dataRows.join("")}</w:tbl>`;
    return { tableXml, headers, sampleRows };
  }

  /**
   * 提取单条记录的属性值映射
   *
   * 键为 rj-property-map 中使用的属性名，值为单元格文本。
   * DataRecord 的 name 数组：
   * - 正常行（seq 为数字且 1-2 个值）拆分为 detectValue/detectDate；
   * - 多值行（seq 非数字或超过 2 个值）按 ", " 合并为 detectValue，并抑制重复 sourceReport。
   */
  private extractRecordValues(
    entityType: string,
    record: RdfEntity,
    seq: string,
    detectItem?: string
  ): Record<string, string> {
    const get = (prop: string) =>
      this.getValue(record[`${RJ_PROP_PREFIX}${prop}`]);

    const values: Record<string, string> = { seq };

    // 通用可提取属性（只在存在时放入，避免空列）
    const addIfPresent = (prop: string, value?: string) => {
      const v = value !== undefined ? value : get(prop);
      if (v) {
        values[prop] = v;
      }
    };

    addIfPresent("sourceReport");
    addIfPresent("location");
    addIfPresent("burialDepth");
    addIfPresent("latitude");
    addIfPresent("longitude");
    addIfPresent("material");
    addIfPresent("currentValue");
    addIfPresent("resistivity");

    switch (entityType) {
      case "CrossingRecord": {
        const riverName = get("riverName") || get("name") || this.getRdfsLabel(record);
        addIfPresent("riverName", riverName);
        // 统一用 crossingType 保存穿越方式（原始数据可能是 crossingType 或 crossingMethod）
        const crossingWay = get("crossingType") || get("crossingMethod");
        addIfPresent("crossingType", crossingWay);
        addIfPresent("startLocation");
        addIfPresent("endLocation");
        addIfPresent("length");
        break;
      }
      case "GroundDevice": {
        const deviceType = get("deviceType") || this.getRdfsLabel(record);
        const name = get("name") || deviceType;
        addIfPresent("deviceType", deviceType);
        addIfPresent("name", name);
        break;
      }
      case "PipelineComponent": {
        const name = get("name") || this.getRdfsLabel(record);
        addIfPresent("name", name);
        break;
      }
      case "OverheadRecord": {
        addIfPresent("overheadMethod");
        const name = get("name") || this.getRdfsLabel(record);
        addIfPresent("name", name);
        break;
      }
      case "DataRecord": {
        if (detectItem) {
          values[DATA_RECORD_DETECT_ITEM_PROP] = detectItem;
        }
        const nameProp = record[`${RJ_PROP_PREFIX}name`];
        const names = (nameProp || [])
          .map(v => String(v.value || "").trim())
          .filter(n => n.length > 0);
        const isMultiValue = detectItem !== undefined || names.length > 2;
        if (names.length > 0) {
          if (isMultiValue) {
            values[DATA_RECORD_DETECT_VALUE_PROP] = names.join(", ");
            const sr = values.sourceReport;
            if (sr && names.includes(sr)) {
              delete values.sourceReport;
            }
          } else {
            values[DATA_RECORD_DETECT_VALUE_PROP] = names[0];
            if (names.length > 1) {
              values[DATA_RECORD_DETECT_DATE_PROP] = names[1];
            }
          }
        }
        break;
      }
      default: {
        const name = get("name") || this.getRdfsLabel(record);
        addIfPresent("name", name);
      }
    }

    return values;
  }

  /** 构建 BasicInfo */
  private buildBasicInfo(graph: RdfGraph, override?: Partial<BasicInfo>): BasicInfo {
    // 从知识图谱中尝试提取信息
    let deviceName = "";
    for (const [, entity] of Object.entries(graph)) {
      const type = this.getEntityType(entity);
      if (["ReportSection", "ConclusionSection", "AnnexSection", "SoilSection", "Entity"].includes(type)) continue;
      if (!type) continue;
      const sr = this.getValue(entity["http://example.org/report#sourceReport"]);
      if (sr) {
        deviceName = sr;
        break;
      }
    }

    const defaultBasicInfo: BasicInfo = {
      reportNumber: "",
      companyName: "",
      deviceName,
      reportTypePrefix: "",
      inspectionStartDate: "",
      inspectionEndDate: "",
      inspectorDate: "",
      checkerDate: "",
      reviewerDate: "",
    };

    // 合并 override
    if (override) {
      for (const key of Object.keys(defaultBasicInfo) as (keyof BasicInfo)[]) {
        if (override[key] !== undefined && override[key] !== "") {
          (defaultBasicInfo as any)[key] = override[key];
        }
      }
    }

    return defaultBasicInfo;
  }

  // ========== XML 构建工具方法 ==========

  /** 构建 <w:t> 文本节点 */
  private buildWt(text: string): string {
    return `<w:t xml:space="preserve">${this.escapeXml(text)}</w:t>`;
  }

  /** 构建 <w:tc> 单元格 */
  private buildWtc(text: string): string {
    return `<w:tc><w:p><w:r>${this.buildWt(text)}</w:r></w:p></w:tc>`;
  }

  /** 构建 <w:tr> 行 */
  private buildWtr(cellsXml: string): string {
    return `<w:tr>${cellsXml}</w:tr>`;
  }

  /** XML 转义 */
  private escapeXml(text: string): string {
    return text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  // ========== RDF 工具方法 ==========

  /** 提取 RDF 属性值数组的第一个 literal value */
  private getValue(prop: RdfValue[] | undefined): string {
    if (!prop || prop.length === 0) return "";
    return String(prop[0].value || "");
  }

  /** 提取 RDF 属性值数组的第一个 uri value */
  private getUriValue(prop: RdfValue[] | undefined): string {
    if (!prop || prop.length === 0) return "";
    const v = prop[0];
    return v.type === "uri" ? v.value : "";
  }

  /** 从实体提取类型（如 http://.../report#CrossingRecord → CrossingRecord） */
  private getEntityType(entity: RdfEntity): string {
    const typeProp = entity["http://www.w3.org/1999/02/22-rdf-syntax-ns#type"];
    if (!typeProp || typeProp.length === 0) return "";
    const uri = typeProp[0].value || "";
    const m = uri.match(/#(\w+)$/);
    return m ? m[1] : "";
  }

  /** 从实体的 rdfs:label 属性提取文本 */
  private getRdfsLabel(entity: RdfEntity): string {
    return this.getValue(entity["http://www.w3.org/2000/01/rdf-schema#label"]);
  }
}

export const statementsParser = new StatementsParser();
