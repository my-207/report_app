# -*- coding: utf-8 -*-
"""
最终版：精确提取所有占位符，只分析 <w:t> 标签中的纯文本内容。
使用 lxml/xml.etree 正确解析 XML。
"""
import re
import zipfile
import xml.etree.ElementTree as ET
from collections import defaultdict

TEMPLATE_PATH = "../年度检查报告（模版）.docx"
NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"

def main():
    with zipfile.ZipFile(TEMPLATE_PATH, "r") as zf:
        tree = ET.parse(zf.open("word/document.xml"))
    
    root = tree.getroot()
    
    # 遍历所有表格，标注每个表格内的 w:t 文本
    all_texts = []  # [(table_index_or_None, paragraph_text)]
    
    # 先获取所有文本段落（非表格内）
    body = root.find(f"{{{NS}}}body")
    
    current_table = 0  # 0 = 正文, >=1 = 表格编号
    
    for elem in body.iter():
        tag = elem.tag.split("}")[-1] if "}" in elem.tag else elem.tag
        
        if tag == "tbl":
            current_table += 1
        
        if tag == "t":
            text = elem.text or ""
            if text.strip() and 'X' in text:
                # 只保留真正的占位符：连续3个以上X，或20XX模式
                if re.search(r'X{3,}|20\dX', text):
                    loc = f"正文" if current_table == 0 else f"表格{current_table}"
                    all_texts.append((loc, text.strip()))
    
    # 按位置分组输出
    print("=" * 80)
    print("模板占位符完整清单")
    print("=" * 80)
    
    current = None
    for loc, text in all_texts:
        if loc != current:
            current = loc
            print(f"\n--- {current} ---")
        print(f"  {text}")
    
    # 去重统计
    print("\n" + "=" * 80)
    print("去重统计（按文本内容）:")
    print("=" * 80)
    seen = defaultdict(int)
    for _, text in all_texts:
        seen[text] += 1
    
    for text, count in sorted(seen.items(), key=lambda x: -x[1]):
        print(f"  [{count:2d}x] {text}")
    
    print(f"\n总计: {len(all_texts)} 个占位符片段, {len(seen)} 种模式")
    
    # 分类
    print("\n" + "=" * 80)
    print("按类型分类:")
    print("=" * 80)
    
    categories = {
        "报告编号 (XXXXX-XXXX-XXXX-202X)": lambda t: re.search(r'X{2,5}-X{2,4}-X{2,4}-20\dX', t),
        "单位名称 (XXXXXXX公司)": lambda t: t == "XXXXXXX公司",
        "设备名称 (XXXXXXXXXXXX)": lambda t: t == "XXXXXXXXXXXX",
        "报告前缀 (XXXXXXXXX/XXXXXXXX/XXXXX/XXXXXX)": lambda t: '/' in t and 'X' in t,
        "检验日期范围 (202X年X月-202X年X月)": lambda t: '年' in t and '-' in t and '月' in t and 'X' in t,
        "签名日期 (202X年X月XX日)": lambda t: re.search(r'20\dX年\d?X月\d?X?日?', t) and '-' not in t,
        "年度检查结论中的X (XXXXX)": lambda t: t == "XXXXX",
        "其他X模式": lambda t: True,
    }
    
    classified = {k: [] for k in categories}
    for loc, text in all_texts:
        for cat_name, check_fn in categories.items():
            if check_fn(text):
                classified[cat_name].append((loc, text))
                break
    
    for cat_name, items in classified.items():
        if items:
            print(f"\n  {cat_name}: {len(items)} 处")
            for loc, text in items:
                print(f"    [{loc}] {text}")

if __name__ == "__main__":
    main()
