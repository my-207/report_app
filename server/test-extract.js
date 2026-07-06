const AdmZip = require("adm-zip");
const fs = require("fs");
const path = require("path");

// 1. 解压
const docxPath = "c:/Users/Administrator/CodeBuddy/报告生成/年度检查报告（模版）.docx";
const outDir = "c:/Users/Administrator/CodeBuddy/报告生成/server/sessions/test123";
const zip = new AdmZip(docxPath);
zip.extractAllTo(outDir, true);
console.log("1. 解压完成");

// 2. 读取 document.xml
const xml = fs.readFileSync(path.join(outDir, "word", "document.xml"), "utf-8");
console.log("2. XML 长度:", xml.length);

// 3. 查找占位符
const patterns = [
  { name: "报告编号 (XXXXX-XXXX-XXXX-202X)", regex: /XXXXX-XXXX-XXXX-20\d{2}/g },
  { name: "公司名 (XXXXXXX公司)", regex: /X{6,}公司/g },
  { name: "设备名 (XXXXXXXXXXXX)", regex: /X{10,}(?!\/)/g },
  { name: "报告类型前缀", regex: /X{5,}\/X{5,}\/X{4,}\/X{4,}/g },
  { name: "检验日期范围", regex: /20\d{2}年\d{1,2}月-20\d{2}年\d{1,2}月/g },
  { name: "签名日期", regex: /20\d{2}年X月XX日/g },
];

patterns.forEach((p) => {
  const matches = xml.match(p.regex);
  console.log("   " + p.name + ": " + (matches ? matches.length + " 处 → " + matches.join(", ") : "0 处"));
});

// 4. 查找表格
const tblMatches = xml.match(/<w:tbl\b/g);
console.log("3. 表格数量:", tblMatches ? tblMatches.length : 0);

// 5. 提取所有表格的表头
const tblRegex = /<w:tbl\b[\s\S]*?<\/w:tbl>/g;
let tblMatch;
let idx = 0;
while ((tblMatch = tblRegex.exec(xml)) !== null) {
  const firstTrMatch = /<w:tr\b[\s\S]*?<\/w:tr>/.exec(tblMatch[0]);
  if (firstTrMatch) {
    const headers = [];
    const wtRegex = /<w:t[^>]*>(.*?)<\/w:t>/g;
    let wtMatch;
    while ((wtMatch = wtRegex.exec(firstTrMatch[0])) !== null) {
      const t = wtMatch[1].trim();
      if (t) headers.push(t);
    }
    console.log("   表格" + (idx + 1) + " 表头: [" + headers.join(", ") + "]");
  }
  idx++;
}

// 6. 测试打包
const outputPath = "c:/Users/Administrator/CodeBuddy/报告生成/server/output/test-packed.docx";
const packZip = new AdmZip();
function addDirToZip(z, dir, prefix) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    const zipPath = prefix ? prefix + "/" + entry.name : entry.name;
    if (entry.isDirectory()) {
      z.addFile(zipPath + "/", Buffer.alloc(0));
      addDirToZip(z, fullPath, zipPath);
    } else {
      z.addFile(zipPath, fs.readFileSync(fullPath));
    }
  }
}
addDirToZip(packZip, outDir, "");
packZip.writeZip(outputPath.replace(/\.docx$/, ".zip"));
fs.renameSync(outputPath.replace(/\.docx$/, ".zip"), outputPath);
console.log("4. 打包测试完成:", outputPath);

console.log("\n✅ 全部测试通过!");
