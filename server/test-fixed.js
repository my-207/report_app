const fs = require("fs");
const xml = fs.readFileSync("c:/Users/Administrator/CodeBuddy/报告生成/server/sessions/test-quick/word/document.xml", "utf-8");

function extractTagContent(xml, startPos, tagName) {
  const openPattern = new RegExp("<" + tagName + "[ >]", "g");
  const closeTag = "</" + tagName + ">";
  let depth = 1;
  let pos = startPos;
  const tagEnd = xml.indexOf(">", pos);
  if (tagEnd === -1) return null;
  pos = tagEnd + 1;
  let it = 0;
  while (pos < xml.length - closeTag.length && it < 20000) {
    it++;
    openPattern.lastIndex = pos;
    const nextOpenMatch = openPattern.exec(xml);
    const nextOpen = nextOpenMatch ? nextOpenMatch.index : -1;
    const nextClose = xml.indexOf(closeTag, pos);
    if (nextClose === -1) return null;
    if (nextOpen !== -1 && nextOpen < nextClose) {
      depth++;
      const end = xml.indexOf(">", nextOpen);
      pos = end !== -1 ? end + 1 : nextOpen + tagName.length + 3;
    } else {
      depth--;
      if (depth === 0) return xml.substring(startPos, nextClose + closeTag.length);
      pos = nextClose + closeTag.length;
    }
  }
  return null;
}

console.log("=== 表格表头提取测试 (修复版) ===\n");
const tblOpenRegex = /<w:tbl[ >]/g;
let tblMatch, tblIdx = 0, dataTbls = 0;

while ((tblMatch = tblOpenRegex.exec(xml)) !== null && tblIdx < 15) {
  tblIdx++;
  const tbl = extractTagContent(xml, tblMatch.index, "w:tbl");
  if (!tbl) continue;

  // 提取第一行
  const trOpenRegex = /<w:tr[ >]/g;
  trOpenRegex.lastIndex = 0;
  const firstTrMatch = trOpenRegex.exec(tbl);
  if (!firstTrMatch) continue;

  const firstTr = extractTagContent(tbl, firstTrMatch.index, "w:tr");
  if (!firstTr) continue;

  const wtRegex = /<w:t[^>]*>(.*?)<\/w:t>/g;
  const texts = [];
  let wm;
  while ((wm = wtRegex.exec(firstTr)) !== null) {
    const t = wm[1].trim();
    if (t && !t.startsWith("<") && t.length < 30) texts.push(t);
  }

  if (texts.length > 0) {
    dataTbls++;
    console.log("表格" + tblIdx + ": [" + texts.join(", ") + "]");
  }
}

console.log("\n前15个中数据表格: " + dataTbls + " 个");

// 占位符验证
console.log("\n=== 占位符验证 ===");
const checks = [
  ["报告编号：XXXXX-XXXX-XXXX-202X", "报告编号"],
  ["XXXXXXX公司", "公司名"],
  ["XXXXXXXXXXXX", "设备名"],
  ["202X年6月", "开始日期"],
  ["202X年7月", "结束日期"],
  ["202X年X月XX日", "签名日期"],
];
for (const [pat, name] of checks) {
  const count = (xml.match(new RegExp(pat.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g")) || []).length;
  console.log(name + ": " + count + " 处");
}
console.log("\n✅ 测试完成!");
