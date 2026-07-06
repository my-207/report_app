import path from "path";
import fs from "fs";
import { chapterExtractor } from "../services/chapter-extractor.service";
import { fillerService } from "../services/filler.service";
import { docxService } from "../services/docx.service";
import { templateService } from "../services/template.service";

async function main() {
  const projectRoot = path.join(__dirname, "..", "..", "..");
  const templatePath = path.join(projectRoot, "年度检查报告（模版）.docx");
  const mdPath = path.join(projectRoot, "原始MD.docx");
  const outputPath = path.join(projectRoot, "output", "debug-md-报告.docx");

  // 1. 上传/解压模板
  const templateBuffer = fs.readFileSync(templatePath);
  const { sessionId: templateSessionId } = await templateService.processUpload(templateBuffer, "年度检查报告（模版）.docx");

  // 2. 解压并分析原始 MD
  const mdUnpackDir = path.join(projectRoot, "output", "_md_unpack");
  await docxService.unpack(mdPath, mdUnpackDir);
  const analysis = await chapterExtractor.analyze(mdUnpackDir);

  console.log("MD 源分析结果:");
  console.log("  章节数:", analysis.totalChapters);
  console.log("  表格数:", analysis.totalTables);
  console.log("  键值对表:", analysis.keyValueTableCount);
  console.log("  键值对数:", analysis.keyValuePairCount);
  console.log("  章节ID:", analysis.chapters.map(c => c.id));
  console.log("  basicInfo:", analysis.basicInfo);

  // 3. 执行填充
  const { fillResult, subtreeStats } = await fillerService.fillBySubtreeCopy(templateSessionId, mdUnpackDir, analysis);

  console.log("\n填充结果:");
  console.log(JSON.stringify(fillResult, null, 2));
  console.log("子树统计:", JSON.stringify(subtreeStats, null, 2));

  // 4. 打包
  const templateEntry = templateService.getSession(templateSessionId);
  await docxService.pack(templateEntry!.unpackDir, outputPath);
  console.log("\n输出:", outputPath);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
