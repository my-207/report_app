/**
 * 双源填充端到端验证脚本
 * 测试: 模板.docx + .rj + 原始MD.docx → 生成报告
 */
import path from "path";
import fs from "fs";
import { templateService } from "../services/template.service";
import { fillerService } from "../services/filler.service";
import { statementsParser } from "../services/statements-parser.service";
import { chapterExtractor } from "../services/chapter-extractor.service";
import { docxService } from "../services/docx.service";
import { isKeyValueTable, getCellMergedTexts, extractTagContent } from "../utils/xml-utils";
import { logger } from "../utils/logger";

const projectRoot = path.resolve(__dirname, "../../..");

async function main() {
  console.log("=== 双源填充端到端验证 ===\n");

  // 1. 上传模板
  const templatePath = path.join(projectRoot, "年度检查报告（模版）.docx");
  const templateBuf = fs.readFileSync(templatePath);
  const { sessionId: templateSessionId } = await templateService.processUpload(
    templateBuf, "年度检查报告（模版）.docx"
  );
  console.log("1. 模板上传成功: sessionId =", templateSessionId);

  // 2. 解析 .rj
  const rjPath = path.join(projectRoot, "statements.rj");
  const rjContent = fs.readFileSync(rjPath, "utf-8");
  const rjAnalysis = statementsParser.parse(rjContent);
  console.log("2. .rj 解析: ", rjAnalysis.totalChapters, "章,", rjAnalysis.totalTables, "表");

  // 3. 解析 原始MD.docx
  const mdPath = path.join(projectRoot, "原始MD.docx");
  const mdUnpackDir = path.join(projectRoot, "output", "_verify_md_unpack");
  await docxService.unpack(mdPath, mdUnpackDir);
  const mdAnalysis = await chapterExtractor.analyze(mdUnpackDir);
  console.log("3. MD解析: ", mdAnalysis.totalChapters, "章,", mdAnalysis.totalTables, "表");
  console.log("   keyValueTableCount:", mdAnalysis.keyValueTableCount);

  // 检查 MD 关键数据
  console.log("\n--- MD BasicInfo ---");
  console.log(JSON.stringify(mdAnalysis.basicInfo));
  console.log("\n--- MD 章节表格 ---");
  mdAnalysis.chapters.forEach(ch => {
    ch.tables.forEach((t, i) => {
      const firstRow = t.match(/<w:tr[ >][\s\S]*?<\/w:tr>/)?.[0] || "";
      const texts = getCellMergedTexts(firstRow).filter(t => t && t.length < 30);
      const isKv = isKeyValueTable(t);
      console.log(`  章节${ch.id} 表[${i}] 键值对:${isKv} 表头:[${texts.join("|")}] sig:${ch.signatureText ? "有" : "无"}`);
    });
  });

  // 4. 双源合并
  const mergedAnalysis = fillerService.mergeSourceAnalysis(rjAnalysis, mdAnalysis);
  console.log("\n4. 双源合并: ", mergedAnalysis.totalChapters, "章,", mergedAnalysis.totalTables, "表");
  console.log("   合并后BasicInfo:", JSON.stringify({
    reportNumber: mergedAnalysis.basicInfo.reportNumber,
    companyName: mergedAnalysis.basicInfo.companyName,
    deviceName: mergedAnalysis.basicInfo.deviceName,
  }));

  // 输出每个合并章节的表格信息
  mergedAnalysis.chapters.forEach(ch => {
    ch.tables.forEach((t, i) => {
      const firstRow = t.match(/<w:tr[ >][\s\S]*?<\/w:tr>/)?.[0] || "";
      const texts = getCellMergedTexts(firstRow).filter(t => t && t.length < 30);
      const isKv = isKeyValueTable(t);
      console.log(`  合并后 章节${ch.id} 表[${i}] 键值对:${isKv} 表头:[${texts.join("|")}] sig:${ch.signatureText ? "有" : "无"}`);
    });
  });

  // 5. 执行填充
  const templateXml = await templateService.getDocumentXml(templateSessionId);
  const templateAnalysis = await templateService.analyzeTemplate(templateSessionId);
  console.log("\n5. 模板分析:", templateAnalysis.tables.length, "表格");

  const unpackDir = templateService.getSession(templateSessionId)?.unpackDir || "";
  const { fillResult, subtreeStats } = await fillerService.fillBySubtreeCopy(
    templateSessionId, unpackDir, mergedAnalysis
  );

  console.log("\n6. 填充结果:");
  console.log("   success:", fillResult.success);
  console.log("   stats:", JSON.stringify(fillResult.stats));
  console.log("   subtreeStats:", JSON.stringify(subtreeStats));
  if (fillResult.warnings) console.log("   warnings:", fillResult.warnings);

  // 7. 检查填充后XML中的残留占位符
  const filledXml = await templateService.getDocumentXml(templateSessionId);
  const remainingPlaceholders = filledXml.match(/X{3,}/g) || [];
  console.log("   残留占位符 (X{3,}):", remainingPlaceholders.length, "个");

  // 8. 打包输出
  const outputPath = path.join(projectRoot, "output", "验证_双源填充报告.docx");
  await docxService.pack(unpackDir, outputPath);
  console.log("\n7. 输出文件:", outputPath);
  console.log("\n=== 验证完成 ===");
}

main().catch(err => {
  console.error("验证失败:", err);
  process.exit(1);
});
