const fs = require("fs");
const xml = fs.readFileSync("c:/Users/Administrator/CodeBuddy/报告生成/server/sessions/test-quick/word/document.xml", "utf-8");

// 查找 <w:tbl 的匹配
let pos = 0, count = 0;
while ((pos = xml.indexOf("<w:tbl ", pos)) !== -1) {
  count++;
  // 找对应的 </w:tbl>
  let depth = 0;
  for (let i = pos; i < xml.length - 7; i++) {
    if (xml.substring(i, i + 5) === "<w:tbl" && xml[i + 5] === " ") depth++;
    else if (xml.substring(i, i + 7) === "</w:tbl>") {
      depth--;
      if (depth === 0) {
        const tbl = xml.substring(pos, i + 7);
        console.log("表格" + count + ": 长度=" + tbl.length + " 包含<w:tr>=" + (tbl.match(/<w:tr /g) || []).length + " 个");
        
        // 提取第一个 tr
        let trStart = tbl.indexOf("<w:tr ");
        if (trStart !== -1) {
          let trDepth = 0;
          for (let j = trStart; j < tbl.length - 6; j++) {
            if (tbl.substring(j, j + 4) === "<w:tr" && tbl[j + 4] === " ") trDepth++;
            else if (tbl.substring(j, j + 6) === "</w:tr") {
              trDepth--;
              if (trDepth === 0) {
                const tr = tbl.substring(trStart, j + 6);
                const texts = [];
                const wtRegex = /<w:t[^>]*>(.*?)<\/w:t>/g;
                let wm;
                while ((wm = wtRegex.exec(tr)) !== null) {
                  const t = wm[1].trim();
                  if (t && !t.startsWith("<") && t.length < 30) texts.push(t);
                }
                if (texts.length > 0) console.log("  表头: [" + texts.join(", ") + "]");
                break;
              }
            }
          }
        }
        break;
      }
    }
  }
  pos++;
  if (count >= 5) break;
}
console.log("\n总表格数: " + count);
