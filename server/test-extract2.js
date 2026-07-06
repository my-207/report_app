const AdmZip = require("adm-zip");
const fs = require("fs");
const path = require("path");

const docxPath = "c:/Users/Administrator/CodeBuddy/报告生成/年度检查报告（模版）.docx";
const outDir = "c:/Users/Administrator/CodeBuddy/报告生成/server/sessions/test123";

// 1. 解压
const zip = new AdmZip(docxPath);
zip.extractAllTo(outDir, true);
console.log("1. 解压完成");

// 2. 读取 document.xml
const xml = fs.readFileSync(path.join(outDir, "word", "document.xml"), "utf-8");
console.log("2. XML 长度:", xml.length);

// 3. 提取所有 <w:t> 文本节点
const wtRegex = /<w:t[^>]*>(.*?)<\/w:t>/g;
let wtMatch;
const texts = [];
while ((wtMatch = wtRegex.exec(xml)) !== null) {
  const t = wtMatch[1].trim();
  if (t) texts.push(t);
}
console.log("3. 文本节点总数:", texts.length);

// 4. 占位符匹配测试
const patterns = [
  { name: "报告编号", regex: /XXXXX-XXXX-XXXX-20\d{2}/g },
  { name: "公司名", regex: /X{6,}公司/g },
  { name: "设备名(长X)", regex: /X{10,}(?!\/)/g },
  { name: "报告类型前缀", regex: /X{5,}\/X{5,}\/X{4,}\/X{4,}/g },
  { name: "检验日期范围", regex: /20\d{2}年[\s\u3000]*\d{1,2}月[\s\u3000]*-[\s\u3000]*20\d{2}年[\s\u3000]*\d{1,2}月/g },
  { name: "签名日期", regex: /20\d{2}年X月XX日/g },
];

console.log("\n4. 占位符匹配结果:");
for (const { name, regex } of patterns) {
  let found = 0;
  const matches = [];
  for (const text of texts) {
    const m = text.match(regex);
    if (m) {
      found += m.length;
      matches.push(text);
    }
  }
  console.log("   " + name + ": " + found + " 处" + (matches.length > 0 ? " → " + matches.slice(0, 3).join(" | ") : ""));
}

// 5. 表头提取测试（修复版）
function extractFirstTr(tblContent) {
  const startMatch = /<w:tr\b/.exec(tblContent);
  if (!startMatch) return null;
  let pos = startMatch.index;
  let depth = 0;
  for (let i = pos; i < tblContent.length - 6; i++) {
    if (tblContent.substring(i, i + 5) === "<w:tr" && (tblContent[i + 5] === ">" || tblContent[i + 5] === " ")) {
      depth++;
    } else if (tblContent.substring(i, i + 6) === "</w:tr") {
      depth--;
      if (depth === 0) return tblContent.substring(pos, i + 6);
    }
  }
  return null;
}

const tblRegex = /<w:tbl\b[\s\S]*?<\/w:tbl>/g;
let tblMatch;
let tableIdx = 0;
console.log("\n5. 表格表头提取:");
while ((tblMatch = tblRegex.exec(xml)) !== null && tableIdx < 10) {
  const firstTr = extractFirstTr(tblMatch[0]);
  if (firstTr) {
    const headers = [];
    const wtRegex2 = /<w:t[^>]*>(.*?)<\/w:t>/g;
    let wm;
    while ((wm = wtRegex2.exec(firstTr)) !== null) {
      const t = wm[1].trim();
      if (t) headers.push(t);
    }
    // 过滤掉纯 XML 碎片
    const cleanHeaders = headers.filter(h => !h.startsWith("<") && h.length < 50);
    if (cleanHeaders.length > 0) {
      console.log("   表格" + (tableIdx + 1) + ": [" + cleanHeaders.join("], [") + "]");
    }
  }
  tableIdx++;
}

// 6. 检查跨 run 的报告编号
console.log("\n6. 跨 run 报告编号检测:");
// 查找 XXXXX-XXXX-XXXX-202X 周围的 run 结构
const runContext = xml.match(/(?:<w:r\b[^>]*>[\s\S]*?<\/w:r>\s*){0,3}X{2,5}(?:[\s\S]*?<w:r\b[^>]*>[\s\S]*?<\/w:r>\s*){0,10}/g);
if (runContext) {
  console.log("   找到 " + runContext.length + " 个可能的多 run 上下文");
  // 只看包含 XXXXX-XXXX-XXXX 模式的
  const relevant = runContext.filter(c => /X{2,5}-X{3,4}-X{3,4}-20\d{2}/.test(c.replace(/<\/?[^>]+>/g, "")));
  console.log("   其中 " + relevant.length + " 个包含报告编号模式");
  if (relevant.length > 0) {
    const clean = relevant[0].replace(/<\/?[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    console.log("   示例: " + clean.substring(0, 100));
  }
}

console.log("\n✅ 测试完成!");
