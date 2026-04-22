# APITable Snapshot 数据结构详解

> 来源: https://apitable.getoutline.com/s/751b142b-866f-4174-a5f1-a2975f85ad41/doc/0x3-snapshots-3lIAWPoaIx

## 核心概念: Snapshot
Snapshot 是描述一个数据表(datasheet)的**完整数据结构**。前端通过解析这个结构构建UI，后端通过维护这个结构实现业务逻辑。

Snapshot 通过 `dataPack` 接口返回，包含三个核心部分:
1. **datasheetId** — 标识属于哪个数据表
2. **meta** — 表结构元数据(schema定义)
3. **recordMap** — 表数据实体

---

## Meta (元数据/Schema)

Meta 不包含实际数据记录，但定义了数据的**结构/schema**。

### FieldMap (字段映射)
- K-V结构: key = `fieldId`, value = 字段属性
- 不存储顺序信息，是整个表结构的集合
- 字段的顺序和显隐由 Views 中的 columns 控制

### Field (字段)
APITable 共有 **24种字段类型**:

#### 15种基础字段 (用户可直接编辑)
- 每种字段有专门的交互编辑器
- 帮助用户更容易输入该类型的数据
- 限制输入不合规数据

#### 9种高级字段
- 大多数是**计算字段(computed fields)**，值是动态计算的
- 不可直接编辑单元格

| 高级字段 | 说明 |
|---------|------|
| Magic Link | 唯一可由用户编辑的高级字段，选择关联表记录，类似数据库外键join |
| Rollup | 基于Magic Link关系，跨表数据引用和汇总计算 |
| Formula | 公式计算 |

### PrimaryField (首列/主字段)
- 第一列有特殊限制: 不支持拖拽，Magic Link不能做首列
- 支持的数据类型更少，保证内容相对唯一性
- **注意**: PrimaryField 不是数据库意义上的"主键"

### Views (视图)
Views 是视图信息的数组。数组顺序 = 视图tab的顺序。

```json
{
    "id": "viwUbzkXrV0YK",       // 视图ID (表内唯一)
    "name": "APITable view",      // 视图名称
    "autoSave": false,
    "frozenColumnCount": 1,       // 冻结列数
    "type": 1,                    // 视图类型(表格/看板/画廊...)
    "rows": [                     // 行顺序和属性
        {"recordId": "recVopLz0C6EV"},
        {"recordId": "recLHrg2MmByK"}
    ],
    "columns": [                  // 列顺序和属性
        {"fieldId": "fldjQo71Wn32G", "statType": 1},
        {"fieldId": "fldKoJx7ViqqQ"}
    ]
}
```

**关键设计**: 视图中的 rows/columns 通过 ID 关联到 recordMap/fieldMap，**数据与展示完全分离**。

---

## RecordMap (记录数据)

RecordMap 是以 `recordId` 为 key 的 K-V 结构，无序。顺序由 Views 中的 rows 决定。

```json
{
    "recl1X8h2qQ4J": {
        "id": "recl1X8h2qQ4J",
        "data": {
            "fldO3L8OlyzNC": [{"type": 1, "text": "1"}],
            "fldzySdRslVdV": ["optRUvCnsB9pM"]
        },
        "stringify": {
            "fldO3L8OlyzNC": "1",
            "fldzySdRslVdV": "2"
        },
        "createdAt": 1655876993000,
        "updatedAt": 1655973169721,
        "revisionHistory": [0, 3, 7, 15, 16, 17],
        "recordMeta": {
            "createdAt": "2022-06-22T05:49:53.883Z",
            "createdBy": "eeb620a54e2248c69c25de68e6eb668c",
            "fieldUpdatedMap": {
                "fldO3L8OlyzNC": {
                    "by": "9166bea35d79456994b99956dbfabcb9",
                    "at": 1655973162989
                }
            }
        },
        "commentCount": 0
    }
}
```

### 各字段含义
| 字段 | 说明 |
|------|------|
| **id** | recordId (表内唯一) |
| **data** | 单元格值(cellValue)的原始数据结构，key=fieldId，每种字段类型有独立的数据结构 |
| **stringify** | data的字符串化版本，用于搜索和显示 |
| **revisionHistory** | 版本号数组，记录该行被修改的所有版本 |
| **recordMeta** | 创建人、修改人、修改时间，精确到字段级别 |
| **commentCount** | 评论数 |

### data 的设计要点
- **key = fieldId**: 不用列名而用ID，重命名列不影响数据
- **value = 数组结构**: 每种字段类型有独立的value结构
- **计算字段**: data中的值由计算结果填充，不存储用户输入

---

## 对我们项目的启示

### 1. 数据模型三件套
```
Meta (FieldMap + Views)  →  Schema定义 + 视图配置
RecordMap                →  实际数据
datasheetId              →  表标识
```

### 2. 用 fieldId 而非列名作为数据key
- 列名是展示属性，可随意修改
- fieldId 是稳定标识，数据引用更可靠

### 3. data + stringify 双存储
- data: 结构化原始数据（精确计算用）
- stringify: 文本化数据（搜索/显示用）

### 4. 版本控制内嵌到记录
- revisionHistory 记录每行的修改历史版本
- 字段级别的修改追踪 (fieldUpdatedMap)

### 5. 这对数据分析的影响
- data 的结构化存储使得**按字段类型精确分析**成为可能
- stringify 使得**全文搜索**高效
- fieldMap 中记录了字段类型，分析时可以知道每个值的语义类型
