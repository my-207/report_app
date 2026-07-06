/**
 * .rj 知识图谱属性映射
 *
 * 依据《年度检查报告本体 V1.0》中的数据属性定义，
 * 将 statements.rj 中使用的 http://example.org/report# 属性名映射为中文表头，
 * 并为各实体类型配置推荐列顺序。
 */

/** 通用属性 -> 中文表头映射 */
export const RJ_PROPERTY_LABELS: Record<string, string> = {
  seq: "序号",
  detectItem: "检测项目",
  sourceReport: "所属管道",
  location: "位置",
  burialDepth: "埋深",
  latitude: "纬度",
  longitude: "经度",
  name: "名称",
  material: "材质",
  currentValue: "电流值",
  resistivity: "土壤电阻率",
  deviceType: "装置类型",
  crossingMethod: "穿越方式",
  crossingType: "穿越方式",
  riverName: "名称",
  startLocation: "起始位置",
  endLocation: "结束位置",
  length: "长度",
  overheadMethod: "跨越方式",
};

/** 实体类型 -> 推荐列顺序（属性名） */
export const RJ_ENTITY_COLUMNS: Record<string, string[]> = {
  CrossingRecord: [
    "seq",
    "riverName",
    "crossingType",
    "burialDepth",
    "startLocation",
    "endLocation",
    "length",
    "sourceReport",
  ],
  GroundDevice: [
    "seq",
    "deviceType",
    "location",
    "name",
    "burialDepth",
    "latitude",
    "longitude",
    "sourceReport",
  ],
  PipelineComponent: [
    "seq",
    "name",
    "location",
    "material",
    "burialDepth",
    "sourceReport",
  ],
  DataRecord: [
    "seq",
    "detectItem",
    "location",
    "detectValue",
    "detectDate",
    "material",
    "currentValue",
    "resistivity",
    "burialDepth",
    "sourceReport",
  ],
  OverheadRecord: [
    "seq",
    "overheadMethod",
    "name",
    "location",
    "sourceReport",
  ],
  AnomalyRecord: [
    "seq",
    "location",
    "sourceReport",
  ],
  ConclusionRecord: [
    "seq",
    "location",
    "sourceReport",
  ],
};

/** 默认列顺序（未配置类型时使用） */
export const RJ_DEFAULT_COLUMNS = [
  "seq",
  "name",
  "location",
  "burialDepth",
  "sourceReport",
];

/**
 * 获取实体类型的推荐列顺序
 * @param entityType 实体类型名（如 CrossingRecord）
 */
export function getEntityColumns(entityType: string): string[] {
  return RJ_ENTITY_COLUMNS[entityType] || RJ_DEFAULT_COLUMNS;
}

/**
 * 获取属性的中文标签
 * @param prop 属性名（如 burialDepth）
 */
export function getPropertyLabel(prop: string): string {
  return RJ_PROPERTY_LABELS[prop] || prop;
}

/**
 * 根据实体类型和实际存在的属性，生成最终属性列顺序
 *
 * 规则：
 * 1. 以推荐列顺序为基准；
 * 2. 只保留实际存在值的属性；
 * 3. 推荐列中未包含但实际存在的属性，按字母顺序追加到最后；
 * 4. 同一章节同类型的多条记录合并表头（取并集）。
 *
 * @param entityType 实体类型
 * @param presentProps 实际存在的属性名集合数组（每条记录一个集合）
 * @returns 属性名数组（调用方可再用 getPropertyLabel 转为中文表头）
 */
export function buildColumnOrder(
  entityType: string,
  presentProps: Set<string>[]
): string[] {
  const union = new Set<string>();
  for (const props of presentProps) {
    for (const p of props) {
      union.add(p);
    }
  }

  const recommended = getEntityColumns(entityType);
  const ordered: string[] = [];

  // 按推荐顺序添加存在的属性
  for (const prop of recommended) {
    if (union.has(prop)) {
      ordered.push(prop);
    }
  }

  // 推荐顺序之外的属性按字母顺序追加
  const remaining = Array.from(union)
    .filter(p => !ordered.includes(p))
    .sort((a, b) => a.localeCompare(b));

  return [...ordered, ...remaining];
}

/**
 * 根据实体类型和实际存在的属性，生成中文表头
 *
 * @param entityType 实体类型
 * @param presentProps 实际存在的属性名集合数组（每条记录一个集合）
 */
export function buildHeaders(
  entityType: string,
  presentProps: Set<string>[]
): string[] {
  return buildColumnOrder(entityType, presentProps).map(getPropertyLabel);
}

  /** DataRecord 专用：name 数组拆分后的虚拟属性名 */
export const DATA_RECORD_DETECT_ITEM_PROP = "detectItem";
export const DATA_RECORD_DETECT_VALUE_PROP = "detectValue";
export const DATA_RECORD_DETECT_DATE_PROP = "detectDate";

// 补充 DataRecord 虚拟属性的中文标签
RJ_PROPERTY_LABELS[DATA_RECORD_DETECT_ITEM_PROP] = "检测项目";
RJ_PROPERTY_LABELS[DATA_RECORD_DETECT_VALUE_PROP] = "检测值";
RJ_PROPERTY_LABELS[DATA_RECORD_DETECT_DATE_PROP] = "检测日期";
