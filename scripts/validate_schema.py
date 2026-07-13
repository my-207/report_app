"""
用现有 JSON 数据文件验证 shared/schema/report-data.json Schema 正确性。
需要: pip install jsonschema
"""
import json
import os
import sys

try:
    from jsonschema import validate, ValidationError
except ImportError:
    print("[WARN] jsonschema not installed, running basic structure check...")
    print("       pip install jsonschema for full validation")

    # 降级为基础检查
    root = os.path.dirname(os.path.dirname(__file__))
    schema_path = os.path.join(root, "shared", "schema", "report-data.json")
    schema = json.load(open(schema_path, "r", encoding="utf-8"))

    data_file = os.path.join(root, "年度检查报告（港清复线）.json")
    data = json.load(open(data_file, "r", encoding="utf-8"))

    errors = []

    # 检查顶层结构
    if "basicInfo" not in data:
        errors.append("缺少 basicInfo")
    else:
        bi = data["basicInfo"]
        required_bi = schema["$defs"]["BasicInfo"]["required"]
        for f in required_bi:
            if f not in bi:
                errors.append(f"basicInfo 缺少必填字段: {f}")

    if "sections" not in data:
        errors.append("缺少 sections")
    else:
        for i, s in enumerate(data["sections"]):
            sec_req = schema["$defs"]["SectionData"]["required"]
            for f in sec_req:
                if f not in s:
                    errors.append(f"sections[{i}] 缺少必填字段: {f}")
            # 检查 kvPairs 中 value 的格式
            for j, kv in enumerate(s.get("kvPairs", [])):
                v = kv.get("value")
                if isinstance(v, dict):
                    if "value" not in v or "valid" not in v:
                        errors.append(f"sections[{i}].kvPairs[{j}] ValidationCell 缺少 value/valid")

    if errors:
        for e in errors:
            print(f"  [FAIL] {e}")
        sys.exit(1)
    else:
        print("[OK] Basic structure check passed")
        print("  (install jsonschema for full schema validation)")
    sys.exit(0)


# 完整 jsonschema 校验
root = os.path.dirname(os.path.dirname(__file__))
schema_path = os.path.join(root, "shared", "schema", "report-data.json")
with open(schema_path, "r", encoding="utf-8") as f:
    schema = json.load(f)

data_file = os.path.join(root, "年度检查报告（港清复线）.json")
with open(data_file, "r", encoding="utf-8") as f:
    data = json.load(f)

try:
    validate(instance=data, schema=schema)
    print("[OK] JSON Schema validation passed")
    print(f"  - basicInfo: {len(data['basicInfo'])} fields")
    print(f"  - sections: {len(data['sections'])} sections")

    # 统计信息
    total_kv = sum(len(s.get("kvPairs", [])) for s in data["sections"])
    total_tables = sum(len(s.get("tables", [])) for s in data["sections"])
    total_rows = sum(sum(len(t.get("rows", [])) for t in s.get("tables", [])) for s in data["sections"])
    has_sig = sum(1 for s in data["sections"] if isinstance(s.get("signature"), dict) and any(v for v in s["signature"].values()))
    print(f"  - kvPairs total: {total_kv}")
    print(f"  - DataTable total: {total_tables}")
    print(f"  - data rows total: {total_rows}")
    print(f"  - sections with signature: {has_sig}")
except ValidationError as e:
    print(f"[FAIL] Schema validation failed: {e.message}")
    sys.exit(1)
