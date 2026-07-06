import { test } from "node:test";
import assert from "node:assert";
import { statementsParser } from "../services/statements-parser.service";

function buildSectionEntity(id: string, title: string) {
  return {
    "http://www.w3.org/1999/02/22-rdf-syntax-ns#type": [
      { value: "http://example.org/report#ReportSection", type: "uri" },
    ],
    "http://example.org/report#annexNum": [{ value: id, type: "literal" }],
    "http://example.org/report#sectionTitle": [{ value: title, type: "literal" }],
  };
}

function buildDataRecordEntity(
  sectionUri: string,
  seq?: string,
  names?: string[],
  sourceReports?: string[]
) {
  const entity: Record<string, any> = {
    "http://www.w3.org/1999/02/22-rdf-syntax-ns#type": [
      { value: "http://example.org/report#DataRecord", type: "uri" },
    ],
    "http://example.org/report#belongsToSection": [
      { value: sectionUri, type: "uri" },
    ],
  };
  if (seq !== undefined) {
    entity["http://example.org/report#seq"] = [{ value: seq, type: "literal" }];
  }
  if (names !== undefined) {
    entity["http://example.org/report#name"] = names.map(value => ({
      value,
      type: "literal" as const,
    }));
  }
  if (sourceReports !== undefined) {
    entity["http://example.org/report#sourceReport"] = sourceReports.map(value => ({
      value,
      type: "literal" as const,
      lang: "zh",
    }));
  }
  return entity;
}

test("DataRecord 数字 seq 保持为序号", () => {
  const rj = JSON.stringify({
    "http://example.org/report/Section_3-1": buildSectionEntity("3-1", "Section 3-1"),
    "http://example.org/report/DataRecord_1": buildDataRecordEntity(
      "http://example.org/report/Section_3-1",
      "1",
      ["优"],
      ["港清复线"]
    ),
  });

  const result = statementsParser.parse(rj);
  assert.strictEqual(result.totalTables, 1);
  const preview = result.tablePreviews[0];
  assert.deepStrictEqual(preview.headers, ["序号", "检测值", "所属管道"]);
  assert.strictEqual(preview.sampleRows[0][0], "1");
  assert.strictEqual(preview.sampleRows[0][1], "优");
  assert.strictEqual(preview.sampleRows[0][2], "港清复线");
});

test("DataRecord 非数字 seq 转为检测项目并自动生成序号", () => {
  const rj = JSON.stringify({
    "http://example.org/report/Section_1-1": buildSectionEntity("1-1", "Section 1-1"),
    "http://example.org/report/DataRecord_b": buildDataRecordEntity(
      "http://example.org/report/Section_1-1",
      "绝热层厚度（mm）",
      ["中俄东线", "华北注入支线"],
      ["中俄东线", "华北注入支线"]
    ),
  });

  const result = statementsParser.parse(rj);
  const preview = result.tablePreviews[0];
  assert.deepStrictEqual(preview.headers, ["序号", "检测项目", "检测值"]);
  assert.strictEqual(preview.sampleRows[0][0], "1");
  assert.strictEqual(preview.sampleRows[0][1], "绝热层厚度（mm）");
  assert.strictEqual(preview.sampleRows[0][2], "中俄东线, 华北注入支线");
  assert.ok(!preview.headers.includes("所属管道"), "sourceReport 与 name 重复时应被抑制");
});

test("DataRecord 数字 seq 但 name 多值时合并为检测值", () => {
  const rj = JSON.stringify({
    "http://example.org/report/Section_3-1": buildSectionEntity("3-1", "Section 3-1"),
    "http://example.org/report/DataRecord_2": buildDataRecordEntity(
      "http://example.org/report/Section_3-1",
      "2",
      ["a", "b", "c"],
      ["港清复线"]
    ),
  });

  const result = statementsParser.parse(rj);
  const preview = result.tablePreviews[0];
  assert.deepStrictEqual(preview.headers, ["序号", "检测值", "所属管道"]);
  assert.strictEqual(preview.sampleRows[0][0], "2");
  assert.strictEqual(preview.sampleRows[0][1], "a, b, c");
  assert.strictEqual(preview.sampleRows[0][2], "港清复线");
});

test("DataRecord 缺失 seq 时自动生成序号", () => {
  const rj = JSON.stringify({
    "http://example.org/report/Section_5-5": buildSectionEntity("5-5", "Section 5-5"),
    "http://example.org/report/DataRecord_3": buildDataRecordEntity(
      "http://example.org/report/Section_5-5",
      undefined,
      undefined,
      ["港清复线"]
    ),
  });

  const result = statementsParser.parse(rj);
  const preview = result.tablePreviews[0];
  assert.strictEqual(preview.sampleRows[0][0], "1");
});
