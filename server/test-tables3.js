const fs = require("fs");
const xml = fs.readFileSync("c:/Users/Administrator/CodeBuddy/报告生成/server/sessions/test-quick/word/document.xml", "utf-8");

// 用 <w:tbl> 精确匹配（6个字符），排除 <w:tblPr>
let pos = 0, count = 0;
while ((pos = xml.indexOf("<w:tbl>", pos)) !== -1) {
  count++;
  if (count <= 3) {
    // 找对应的 </w:tbl>
    let depth = 0;
    for (let i = pos; i < xml.length - 7; i++) {
      if (xml.substring(i, i + 6) === "<w:tbl>" && (i === pos || xml.substring(i - 1, i) !== "/")) depth++;
      else if (xml.substring(i, i + 7) === "</w:tbl>") {
        depth--;
        if (depth === 0) {
          const tbl = xml.substring(pos, i + 7);
          const trCount = (tbl.match(/<w:tr>/g) || []).length;
          console.log("表格" + count + ": 长度=" + tbl.length + " 行数=" + trCount);
          
          // 提取第一个 tr 的文本
          let trStart = tbl.indexOf("<w:tr>");
          if (trStart !== -1) {
            let trDepth = 0;
            for (let j = trStart; j < tbl.length - 6; j++) {
              if (tbl.substring(j, j + 5) === "<w:tr>") trDepth++;
              else if (tbl.substring(j, j + 6) === "</w:tr") {
                trDepth--;
                if (trDepth === 0) {
                  const tr = tbl.substring(trStart, j + 6);
                  const wtRegex = /<w:t[^>]*>(.*?)<\/w:t>/g;
                  const texts = [];
                  let wm;
                  while ((wm = wtRegex.exec(tr)) !== null) {
                    const t = wm[1].trim();
                    if (t && !t.startsWith("<") && t.length < 30) texts.push(t);
                  }
                  console.log("  表头: [" + texts.join(", ") + "]");
                  break;
                }
              }
            }
          }
          break;
        }
      }
    }
  }
  pos++;
}
console.log("\n总表格数: " + count);
