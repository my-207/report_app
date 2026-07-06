const fs = require('fs');
const xml = fs.readFileSync('c:/Users/Administrator/CodeBuddy/报告生成/_analysis/template_original/word/document.xml', 'utf8');

// 找 "（1-2）历史失效事件情况报告" 后面的第一个签名行
const titleIdx = xml.indexOf('（1-2）历史失效事件情况报告');
console.log('标题位置:', titleIdx);

// 找后面的 "检测：" 或 "检查："
const sigIdx = xml.indexOf('检测：', titleIdx);
const sigIdx2 = xml.indexOf('检查：', titleIdx);
const idx = Math.min(sigIdx, sigIdx2) >= 0 ? Math.min(sigIdx, sigIdx2) : Math.max(sigIdx, sigIdx2);
console.log('签名行位置:', idx, '(检测:', sigIdx, '检查:', sigIdx2, ')');

if (idx >= 0) {
  const chunk = xml.substring(idx, idx + 3000);
  // 提取所有 <w:t> 文本
  const wtRegex = /<w:t\b[^>]*>([^<]*)<\/w:t>/g;
  let m;
  const texts = [];
  while ((m = wtRegex.exec(chunk)) !== null) {
    if (m[1] !== undefined) {
      texts.push({ 
        text: m[1], 
        display: m[1].replace(/\s/g, '·').replace(/\r/g, '↵').replace(/\n/g, '↵') 
      });
    }
  }
  console.log('\n签名行 <w:t> 文本序列:');
  texts.forEach((t, i) => console.log('  ' + i + ': "' + t.display + '"'));
  
  // 也看原始 XML 片段
  console.log('\n前500字符 XML:');
  console.log(chunk.substring(0, 500).replace(/></g, '>\n<'));
}
