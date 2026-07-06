---
name: fix-grounddevice-empty
overview: 修复地面装置表格空行：GD_ 实体改用 annexNum 归属章节；GroundDevice_ 实体从其他 RDF 属性回退提取装置类型和名称。
todos:
  - id: fix-group
    content: 修改 groupRecordsBySection：第124-129行增加 annexNum 回退逻辑
    status: completed
  - id: fix-crossing
    content: 修改 buildRecordCells CrossingRecord case：riverName 回退到 name/rdfs:label，crossingType 回退到 crossingMethod
    status: completed
  - id: fix-ground
    content: 修改 buildRecordCells GroundDevice case：deviceType 回退到 rdfs:label，name 回退到 deviceType
    status: completed
  - id: add-rdfs-label
    content: 新增 getRdfsLabel 工具方法，从 rdfs:label 属性提取文本
    status: completed
  - id: verify-compile
    content: 编译验证，确保零新增 TypeScript 错误
    status: completed
    dependencies:
      - fix-group
      - fix-crossing
      - fix-ground
      - add-rdfs-label
---

## 问题

（2-2）地面装置检查报告表格填充后仍是空行。根因有两个：

1. **GD_* 实体被丢弃**：3条有完整数据的 GroundDevice 实体使用 `annexNum: "2-2"` 标记章节归属，但 `groupRecordsBySection()` 只检查 `belongsToSection` 属性，这些实体被完全跳过。

2. **GroundDevice_* 实体关键列为空**：大量 GroundDevice_* 实体有 `belongsToSection` 但缺少 `deviceType` 和 `name` 属性，`buildRecordCells` 提取到的值都是空字符串。

同理，CrossingRecord 也有 `CR_*` 前缀实体使用 `annexNum` 标记归属。

## 修复内容

1. **groupRecordsBySection**：增加 `annexNum` 回退逻辑 — 当 `belongsToSection` 为空时，检查 `annexNum` 属性作为章节 ID
2. **buildRecordCells GroundDevice case**：`deviceType` 为空时从 `rdfs:label` 回退，`name` 为空时从 `deviceType` 回退
3. **buildRecordCells CrossingRecord case**：`riverName` 为空时从 `name` 或 `rdfs:label` 回退，`crossingType` 为空时从 `crossingMethod` 回退
4. 新增 `getRdfsLabel` 工具方法

## 技术方案

### 修改文件

`server/src/services/statements-parser.service.ts` — 仅修改此文件，共 3 处改动。

### 改动1：groupRecordsBySection 增加 annexNum 回退（第124-129行）

当前代码：

```typescript
const belongsTo = this.getUriValue(entity["http://example.org/report#belongsToSection"]);
if (!belongsTo) continue;

const sectionId = this.extractSectionId(belongsTo);
if (!sectionId) continue;
```

修改为：

```typescript
const belongsTo = this.getUriValue(entity["http://example.org/report#belongsToSection"]);
let sectionId: string | null = null;

if (belongsTo) {
  sectionId = this.extractSectionId(belongsTo);
}

// 回退：使用 annexNum 作为章节 ID（GD_*/CR_* 等实体使用此属性）
if (!sectionId) {
  const annexNum = this.getValue(entity["http://example.org/report#annexNum"]);
  if (annexNum && grouped.has(annexNum)) {
    sectionId = annexNum;
  }
}

if (!sectionId) continue;
```

### 改动2：buildRecordCells CrossingRecord case 增加回退（第213-223行）

当前代码：

```typescript
case "CrossingRecord":
  return [
    seq,
    get("riverName"),
    get("crossingType"),
    ...
  ];
```

修改为：

```typescript
case "CrossingRecord": {
  const riverName = get("riverName") || get("name") || this.getRdfsLabel(record);
  return [
    seq,
    riverName,
    get("crossingType") || get("crossingMethod"),
    get("burialDepth"),
    get("startLocation"),
    get("endLocation"),
    get("length"),
    get("sourceReport"),
  ];
}
```

### 改动3：buildRecordCells GroundDevice case 增加回退（第224-231行）

当前代码：

```typescript
case "GroundDevice":
  return [
    seq,
    get("deviceType"),
    get("location"),
    get("name"),
    get("sourceReport"),
  ];
```

修改为：

```typescript
case "GroundDevice": {
  const deviceType = get("deviceType") || this.getRdfsLabel(record);
  const name = get("name") || deviceType;
  return [
    seq,
    deviceType,
    get("location"),
    name,
    get("sourceReport"),
  ];
}
```

### 改动4：新增 getRdfsLabel 工具方法（在 getEntityType 方法之后，第372行之前）

```typescript
/** 从实体的 rdfs:label 属性提取文本 */
private getRdfsLabel(entity: RdfEntity): string {
  return this.getValue(entity["http://www.w3.org/2000/01/rdf-schema#label"]);
}
```

### 不变的部分

- API 路由不变
- 前端不变
- 其他实体类型的 buildRecordCells 不变
- fillBySubtreeCopy 流程不变