import * as yaml from "js-yaml";
import { ReportData, UnifiedReportData } from "../types";

/** 生成标准 JSON 数据模板（旧版格式，兼容 ReportData） */
export function generateJsonTemplate(): string {
  const template: ReportData = {
    basicInfo: {
      reportNumber: "GGW-2024-0001",
      companyName: "某某公司",
      deviceName: "某某设备名称",
      reportTypePrefix: "GGW",
      inspectionStartDate: "2024年6月",
      inspectionEndDate: "2024年7月",
      inspectorDate: "2024年6月30日",
      checkerDate: "2024年7月1日",
      reviewerDate: "2024年7月2日",
    },
    tables: buildSampleTables(),
  };

  return JSON.stringify(template, null, 2);
}

/** 生成标准 YAML 数据模板（旧版格式，兼容 ReportData） */
export function generateYamlTemplate(): string {
  const template: ReportData = {
    basicInfo: {
      reportNumber: "GGW-2024-0001",
      companyName: "某某公司",
      deviceName: "某某设备名称",
      reportTypePrefix: "GGW",
      inspectionStartDate: "2024年6月",
      inspectionEndDate: "2024年7月",
      inspectorDate: "2024年6月30日",
      checkerDate: "2024年7月1日",
      reviewerDate: "2024年7月2日",
    },
    tables: buildSampleTables(),
  };

  return yaml.dump(template, {
    indent: 2,
    lineWidth: 120,
    noRefs: true,
    sortKeys: false,
  });
}

/** 生成新版 UnifiedReportData JSON 模板（含 sections + 混合表示例） */
export function generateUnifiedJsonTemplate(): string {
  const template = buildUnifiedSampleData();
  return JSON.stringify(template, null, 2);
}

/** 生成新版 UnifiedReportData YAML 模板（含 sections + 混合表示例） */
export function generateUnifiedYamlTemplate(): string {
  const template = buildUnifiedSampleData();
  return yaml.dump(template, {
    indent: 2,
    lineWidth: 120,
    noRefs: true,
    sortKeys: false,
  });
}

/** 构建 UnifiedReportData 样例数据（keyValuePairs + 混合表 + 列表表） */
function buildUnifiedSampleData(): UnifiedReportData {
  return {
    basicInfo: {
      reportNumber: "GGW-2024-0001",
      companyName: "某某公司",
      deviceName: "某某设备名称",
      reportTypePrefix: "GGW",
      inspectionStartDate: "2024年6月",
      inspectionEndDate: "2024年7月",
      inspectorDate: "2024年6月30日",
      checkerDate: "2024年7月1日",
      reviewerDate: "2024年7月2日",
    },
    sections: [
      {
        id: "sec_1",
        title: "（1-1）基本信息",
        kvPairs: [
          { key: "报告编号", value: "GGW-2024-0001" },
          { key: "管线名称", value: "某某管道" },
          { key: "检测日期", value: "2024年6月" },
        ],
        tables: [],
        signature: {
          inspectorName: "", inspectorDate: "",
          checkerName: "", checkerDate: "",
          reviewerName: "", reviewerDate: "",
        },
      },
      {
        id: "sec_2",
        title: "（3-1）埋地管道外防腐层质量检测报告",
        kvPairs: [
          { key: "检测项目", value: "外防腐层质量检测" },
          { key: "检测日期", value: "2024年6月" },
          { key: "检测标准", value: "GB/T 19285-2014" },
        ],
        tables: [
          {
            tableType: "entity_2",
            headers: ["序号", "测点位置", "检测结果", "评定等级", "备注"],
            rows: [
              { "序号": "1", "测点位置": "K10+50", "检测结果": "合格", "评定等级": "A", "备注": "" },
              { "序号": "2", "测点位置": "K12+80", "检测结果": "合格", "评定等级": "A", "备注": "" },
            ],
          },
        ],
        signature: {
          inspectorName: "张工", inspectorDate: "2024年6月30日",
          checkerName: "李工", checkerDate: "2024年7月1日",
          reviewerName: "王主任", reviewerDate: "2024年7月2日",
        },
        hybridListHeaderRows: 1,
        hasHybridTable: true,
      },
      {
        id: "sec_3",
        title: "（3-2）检测数据记录表",
        kvPairs: [],
        tables: [
          {
            tableType: "entity_3",
            headers: ["序号", "位置", "检测值", "检测日期", "材质", "电流值", "土壤电阻率", "埋深", "所属管道"],
            rows: [
              { "序号": "1", "位置": "K10+50", "检测值": "-0.92", "检测日期": "2024-04-01", "材质": "", "电流值": "", "土壤电阻率": "", "埋深": "1.2", "所属管道": "某某管道" },
              { "序号": "2", "位置": "K12+80", "检测值": "0.015", "检测日期": "2024-04-01", "材质": "", "电流值": "", "土壤电阻率": "", "埋深": "1.1", "所属管道": "某某管道" },
            ],
          },
        ],
        signature: {
          inspectorName: "张工", inspectorDate: "2024年6月30日",
          checkerName: "李工", checkerDate: "2024年7月1日",
          reviewerName: "王主任", reviewerDate: "2024年7月2日",
        },
      },
    ],
  };
}

/** 示例表格数据 — 覆盖年度检查报告本体中的主要字段（旧版格式） */
function buildSampleTables() {
  return [
    {
      tableName: "检测数据记录",
      headers: ["序号", "位置", "检测值", "检测日期", "材质", "电流值", "土壤电阻率", "埋深", "所属管道"],
      rows: [
        ["1", "K10+50", "-0.92", "2024-04-01", "", "", "", "1.2", "某某管道"],
        ["2", "K12+80", "0.015", "2024-04-01", "", "", "", "1.1", "某某管道"],
        ["3", "K15+20", "12.5", "2024-04-02", "", "", "", "1.3", "某某管道"],
      ],
    },
    {
      tableName: "管道部件记录",
      headers: ["序号", "名称", "位置", "材质", "埋深", "所属管道"],
      rows: [
        ["1", "弯头", "K20+100", "L415M", "1.5", "某某管道"],
        ["2", "三通", "K25+300", "L360M", "1.4", "某某管道"],
      ],
    },
    {
      tableName: "穿越段记录",
      headers: ["序号", "名称", "穿越方式", "埋深", "起始位置", "结束位置", "长度", "所属管道"],
      rows: [
        ["1", "京台高速", "定向钻", "12.5", "K30+100", "K30+250", "150", "某某管道"],
        ["2", "大石河", "大开挖", "3.2", "K35+500", "K35+800", "300", "某某管道"],
      ],
    },
    {
      tableName: "地面装置记录",
      headers: ["序号", "装置类型", "位置", "名称", "埋深", "纬度", "经度", "所属管道"],
      rows: [
        ["1", "电位测试桩", "K40+50", "YQL-0057", "", "39.9042", "116.4074", "某某管道"],
        ["2", "标志桩", "K42+100", "BZ-001", "", "39.9100", "116.4100", "某某管道"],
      ],
    },
  ];
}
