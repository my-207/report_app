import { UnifiedReportData, SectionData, KeyValuePair, DataTable, BasicInfo } from "../types";
import { logger } from "../utils/logger";

/**
 * 双源数据合并器 — 将 .rj 和 原始MD.docx 各自的 UnifiedReportData 合并为一份
 * 策略：MD 优先提供键值对和签名数据，.rj 优先提供列表型表格数据
 */
export class DataMerger {
  /** 生成空 UnifiedReportData */
  empty(): UnifiedReportData {
    return {
      basicInfo: this.emptyBasicInfo(),
      sections: [],
    };
  }

  /** 合并两份 UnifiedReportData */
  merge(rjData: UnifiedReportData | null, mdData: UnifiedReportData | null): UnifiedReportData {
    if (!rjData && !mdData) return this.empty();
    if (!rjData) return mdData!;
    if (!mdData) return rjData;

    // 合并 BasicInfo：MD 优先，.rj 补充缺失字段
    const basicInfo: BasicInfo = {
      reportNumber: mdData.basicInfo.reportNumber || rjData.basicInfo.reportNumber || "",
      companyName: mdData.basicInfo.companyName || rjData.basicInfo.companyName || "",
      deviceName: mdData.basicInfo.deviceName || rjData.basicInfo.deviceName || "",
      reportTypePrefix: mdData.basicInfo.reportTypePrefix || rjData.basicInfo.reportTypePrefix || "",
      inspectionStartDate: mdData.basicInfo.inspectionStartDate || rjData.basicInfo.inspectionStartDate || "",
      inspectionEndDate: mdData.basicInfo.inspectionEndDate || rjData.basicInfo.inspectionEndDate || "",
      inspectorDate: mdData.basicInfo.inspectorDate || rjData.basicInfo.inspectorDate || "",
      checkerDate: mdData.basicInfo.checkerDate || rjData.basicInfo.checkerDate || "",
      reviewerDate: mdData.basicInfo.reviewerDate || rjData.basicInfo.reviewerDate || "",
    };

    // 合并 SectionData：按 sectionId 去重
    const sectionMap = new Map<string, SectionData>();

    // 先放入 MD 数据
    for (const s of mdData.sections) {
      // MD 的签名数据优先，同时保留模板定位关键字段
      sectionMap.set(s.id, {
        id: s.id,
        title: s.title,
        kvPairs: [...s.kvPairs],
        tables: [...s.tables],
        signature: { ...s.signature },
        tableIndex: s.tableIndex,
        hasHybridTable: s.hasHybridTable,
        hybridListHeaderRows: s.hybridListHeaderRows,
      });
    }

    // 再合并 .rj 数据
    for (const s of rjData.sections) {
      if (sectionMap.has(s.id)) {
        const existing = sectionMap.get(s.id)!;
        // .rj 的列表型表格追加到已有
        for (const t of s.tables) {
          // 避免重复表格类型
          if (!existing.tables.find(et => et.tableType === t.tableType)) {
            existing.tables.push(t);
          }
        }
        // .rj 的键值对补充（MD 中不存在的）
        for (const kv of s.kvPairs) {
          if (!existing.kvPairs.find(ek => ek.key === kv.key)) {
            existing.kvPairs.push(kv);
          }
        }
        // .rj 的签名补充（MD 空则取 .rj）
        if (s.signature.inspectorName && !existing.signature.inspectorName) {
          existing.signature = { ...s.signature };
        }
      } else {
        // MD 中不存在的章节，直接使用 .rj（保留全部字段，含 tableIndex/hasHybridTable/hybridListHeaderRows）
        sectionMap.set(s.id, {
          ...s,
          kvPairs: [...s.kvPairs],
          tables: [...s.tables],
          signature: { ...s.signature },
        });
      }
    }

    const sections = Array.from(sectionMap.values())
      .sort((a, b) => a.id.localeCompare(b.id));

    logger.info(
      `双源合并: .rj ${rjData.sections.length}章 + MD ${mdData.sections.length}章 → ${sections.length}章`
    );

    return { basicInfo, sections };
  }

  private emptyBasicInfo(): BasicInfo {
    return {
      reportNumber: "", companyName: "", deviceName: "", reportTypePrefix: "",
      inspectionStartDate: "", inspectionEndDate: "",
      inspectorDate: "", checkerDate: "", reviewerDate: "",
    };
  }
}

export const dataMerger = new DataMerger();
