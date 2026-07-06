const AdmZip = require("adm-zip");
const fs = require("fs");
const path = require("path");

const docxPath = "c:/Users/Administrator/CodeBuddy/报告生成/年度检查报告（模版）.docx";
const outDir = "c:/Users/Administrator/CodeBuddy/报告生成/server/sessions/test-quick";

// 1. 解压
const zip = new AdmZip(docxPath);
zip.extractAllTo(outDir, true);
console.log("1. OK - 解压成功");

// 2. 读 XML
const xml = fs.readFileSync(path.join(outDir, "word", "document.xml"), "utf-8");
console.log("2. OK - XML " + xml.length + " 字符");

// 3. 用简单的子串查找代替全局正则
function countIn(str, sub) {
  let count = 0, pos = 0;
  while ((pos = str.indexOf(sub, pos)) !== -1) { count++; pos += sub.length; }
  return count;
}

console.log("\n3. 占位符匹配:");
const checks = [
  ["XXXXX-XXXX-XXXX", "报告编号片段"],
  ["XXXXXXX公司", "公司名"],
  ["XXXXXXXXXXXX", "设备名"],
  ["202X年6月", "检验开始日期"],
  ["202X年7月", "检验结束日期"],
  ["202X年X月XX日", "签名日期"],
  ["XXXXXXXXX/", "报告类型前缀"],
];
for (const [sub, name] of checks) {
  console.log("   " + name + " (" + sub + "): " + countIn(xml, sub) + " 处");
}

// 4. 简单表头提取
function extractFirstTr(tblContent) {
  const startMatch = /<w:tr\b/.exec(tblContent);
  if (!startMatch) return null;
  let depth = 0;
  for (let i = startMatch.index; i < tblContent.length - 6; i++) {
    const s5 = tblContent.substring(i, i + 5);
    if (s5 === "<w:tr" && (tblContent[i + 5] === ">" || tblContent[i + 5] === " ")) depth++;
    else if (tblContent.substring(i, i + 6) === "</w:tr") {
      depth--;
      if (depth === 0) return tblContent.substring(startMatch.index, i + 6);
    }
  }
  return null;
}

const tblStartPositions = [];
let pos = 0;
while ((pos = xml.indexOf("<w:tbl", pos)) !== -1) {
  tblStartPositions.push(pos);
  pos++;
}

// 找对应的 </w:tbl>
const tblContents = [];
for (const start of tblStartPositions) {
  let depth = 0;
  for (let i = start; i < xml.length - 7; i++) {
    if (xml.substring(i, i + 5) === "<w:tbl" && (xml[i + 5] === ">" || xml[i + 5] === " ")) depth++;
    else if (xml.substring(i, i + 7) === "</w:tbl>") {
      depth--;
      if (depth === 0) {
        tblContents.push(xml.substring(start, i + 7));
        break;
      }
    }
  }
}

console.log("\n4. 表格数量: " + tblContents.length);

console.log("   表头提取 (前8个):");
for (let i = 0; i < Math.min(8, tblContents.length); i++) {
  const firstTr = extractFirstTr(tblContents[i]);
  if (firstTr) {
    const texts = [];
    const wtRegex = /<w:t[^>]*>(.*?)<\/w:t>/g;
    let wm;
    while ((wm = wtRegex.exec(firstTr)) !== null) {
      const t = wm[1].trim();
      if (t && !t.startsWith("<") && t.length < 30) texts.push(t);
    }
    if (texts.length > 0) console.log("   表格" + (i + 1) + ": [" + texts.join(", ") + "]");
  }
}

// 5. 检查跨 run 情况 - 查找包含多个 run 且含 XXXXX 的片段
console.log("\n5. 跨 run 检查:");
const runRegex = /<w:r\b[\s\S]*?<\/w:r>/g;
let runs = [];
let rm;
while ((rm = runRegex.exec(xml)) !== null) runs.push(rm[0]);
console.log("   总共 " + runs.length + " 个 <w:r> 节点");

// 检查报告编号附近的 run
for (let i = 0; i < runs.length; i++) {
  if (runs[i].includes("XXXXX-") || runs[i].includes("XXXX-XXXX")) {
    console.log("   发现报告编号 run[" + i + "]: " + runs[i].replace(/<[^>]+>/g, " ").trim().substring(0, 60));
    // 显示相邻 run
    const ctx = runs.slice(Math.max(0, i - 1), Math.min(runs.length, i + 4)).join("").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    console.log("     上下文: " + ctx.substring(0, 100));
    break;
  }
}

console.log("\n✅ 完成!");
