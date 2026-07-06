const fs = require("fs");
const xml = fs.readFileSync("c:/Users/Administrator/CodeBuddy/报告生成/server/sessions/test-quick/word/document.xml", "utf-8");

let pos = xml.indexOf("<w:tbl>");
console.log("第一个表格起始位置: " + pos);
console.log("片段: " + xml.substring(pos, pos + 200));

// 列出该表格区域所有以 <w:tbl 开头的标签
let searchPos = pos;
const tblTags = [];
while (searchPos < xml.length - 5) {
  const idx = xml.indexOf("<w:tbl", searchPos);
  if (idx === -1) break;
  // 找到标签名结束
  let end = idx + 6;
  while (end < xml.length && xml[end] !== ">" && xml[end] !== " " && xml[end] !== "/") end++;
  const tag = xml.substring(idx, end);
  tblTags.push({ pos: idx, tag });
  searchPos = idx + 1;
  if (tblTags.length > 20) break;
}

console.log("\n找到的 <w:tbl* 标签:");
tblTags.slice(0, 15).forEach(t => console.log("  " + t.pos + ": " + t.tag));

// 找第一个 </w:tbl>
const closePos = xml.indexOf("</w:tbl>", pos);
console.log("\n第一个 </w:tbl> 在: " + closePos);

// 看看开标签和闭标签之间有哪些 <w:tbl 开头的标签
const between = xml.substring(pos, closePos);
const innerTags = between.match(/<w:tbl[^\s>]*/g) || [];
console.log("开闭标签之间的 <w:tbl* 标签: " + innerTags.length + " 个");
innerTags.slice(0, 10).forEach(t => console.log("  " + t));
