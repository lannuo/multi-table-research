# 数据存储方案设计（深度分析）

## 核心挑战

多维表格不是简单的表格应用，它本质上是一个**用户自定义的数据库系统**。存储方案必须同时满足三个维度:

1. **数据录入保存** — 用户自定义字段类型，自由添加/修改/删除列
2. **数据分析** — 对用户定义的数据做聚合、筛选、分组、统计
3. **实时协作** — 多人同时编辑，保证数据一致性

---

## 一、用户自定义字段类型带来的存储难题

用户可以创建任意类型的列（文本、数字、日期、单选、多选、附件、关联记录、公式等），这意味着:
- Schema 不是预定义的，而是运行时动态变化的
- 不同表的列结构完全不同
- 同一表的列随时可能增删改

### 三种经典方案对比

#### 方案A: EAV (Entity-Attribute-Value)
```
records:        id, table_id, ...
cell_values:    record_id, field_id, value_text, value_number, value_date, ...
```

| 优点 | 缺点 |
|------|------|
| 最灵活，无Schema变更 | 查询极复杂，多字段筛选需要多次自JOIN |
| 稀疏数据存储高效 | 聚合分析困难（SUM/AVG需要行转列） |
| | 类型安全差 |
| | 数据量大时性能灾难 |

**社区共识**: "EAV适合存储和展示数据，但做复杂查询和数据分析非常痛苦。如果你需要EAV，请用JSONB替代。" — Hacker News

#### 方案B: 动态DDL (每列=数据库列)
```
ALTER TABLE datasheet_xxx ADD COLUMN fld12345 JSONB;
```

| 优点 | 缺点 |
|------|------|
| 查询性能最优 | DDL操作在大表上很慢（锁表） |
| 原生类型安全 | 列数限制（PG默认1600列） |
| 聚合分析原生支持 | Schema管理复杂 |
| | 不适合频繁变更字段的场景 |

#### 方案C: JSONB (推荐)
```
records: id, table_id, data JSONB, ...
```

| 优点 | 缺点 |
|------|------|
| 无需DDL，字段增删改零成本 | 无法直接做数据库级别的类型约束 |
| GIN索引支持高效查询 | 聚合查询语法比原生列复杂 |
| 单行读写，无JOIN | 按字段做范围查询需要额外索引策略 |
| PostgreSQL原生支持 | 极大量数据（千万行）的分析性能不如列式存储 |

---

## 二、数据分析需求的存储考量

多维表格的数据分析需求:
- **聚合**: SUM, AVG, COUNT, MIN, MAX（按用户定义的数字字段）
- **分组**: GROUP BY（按用户定义的单选/日期等字段）
- **筛选**: WHERE（多字段组合筛选）
- **排序**: ORDER BY（按任意字段）
- **跨表关联**: JOIN（通过Link字段关联不同表的数据）
- **仪表盘**: 实时的数据可视化

### JSONB 方案如何支持数据分析

PostgreSQL 的 JSONB 对数据分析有较好支持:

```sql
-- 聚合: 计算某个字段的总和
SELECT SUM((data->>'fld123')::numeric) FROM records WHERE table_id = 'xxx';

-- 分组: 按单选字段分组统计
SELECT data->>'fld456' AS category, COUNT(*)
FROM records WHERE table_id = 'xxx'
GROUP BY data->>'fld456';

-- 筛选: 多字段组合
SELECT * FROM records
WHERE table_id = 'xxx'
  AND (data->>'fld123')::numeric > 100
  AND data->>'fld456' = '已完成';

-- 索引: 为常用查询字段建索引
CREATE INDEX idx_fld123 ON records USING GIN ((data->'fld123'));
-- 或更精确的 btree 索引
CREATE INDEX idx_fld123_numeric ON records (((data->>'fld123')::numeric));
```

### 分析性能优化策略

| 策略 | 说明 |
|------|------|
| **函数索引** | 为高频分析字段创建表达式索引 |
| **物化视图** | 预计算聚合结果，适合仪表盘 |
| **stringify字段** | APITable的data+stringify双存储，搜索走stringify，计算走data |
| **异步聚合** | 数据变更时异步更新聚合缓存 |
| **列式存储扩展** | 大数据量场景引入ClickHouse/DuckDB做OLAP |

---

## 三、推荐方案: 分层存储架构

借鉴 APITable 的 Snapshot 模型 + 分层设计:

```
┌─────────────────────────────────────────────────┐
│                 应用层 (Application)              │
│  Snapshot = Meta(FieldMap + Views) + RecordMap   │
├─────────────────────────────────────────────────┤
│               关系型层 (PostgreSQL)               │
│  ┌──────────┐ ┌──────────┐ ┌──────────────────┐ │
│  │ 元数据    │ │ 记录数据  │ │ 协作数据         │ │
│  │ tables   │ │ records  │ │ changesets       │ │
│  │ fields   │ │ (JSONB)  │ │ operations       │ │
│  │ views    │ │          │ │ snapshots        │ │
│  └──────────┘ └──────────┘ └──────────────────┘ │
├─────────────────────────────────────────────────┤
│              缓存层 (Redis)                       │
│  热点数据缓存 │ 实时协作状态 │ 聚合结果缓存       │
├─────────────────────────────────────────────────┤
│            分析层 (可选, 按需引入)                  │
│  ClickHouse / DuckDB / PostgreSQL 物化视图        │
│  大数据量OLAP分析 │ 仪表盘预计算                    │
└─────────────────────────────────────────────────┘
```

### 具体表结构设计

```sql
-- ===== 元数据层 =====

-- 数据表定义
CREATE TABLE tables (
    id          UUID PRIMARY KEY,
    space_id    UUID NOT NULL,
    name        VARCHAR(255) NOT NULL,
    primary_field_id UUID,  -- 首列字段ID
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- 字段定义 (用户自定义的列)
CREATE TABLE fields (
    id          UUID PRIMARY KEY,  -- 即 fieldId
    table_id    UUID NOT NULL REFERENCES tables(id),
    name        VARCHAR(255) NOT NULL,
    field_type  VARCHAR(50) NOT NULL, -- text, number, date, single_select,
                                     -- multi_select, attachment, link,
                                     -- formula, rollup, lookup...
    config      JSONB,            -- 字段配置(选项列表、公式表达式、关联表ID等)
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- 视图定义
CREATE TABLE views (
    id          UUID PRIMARY KEY,
    table_id    UUID NOT NULL REFERENCES tables(id),
    name        VARCHAR(255) NOT NULL,
    view_type   SMALLINT NOT NULL,  -- 1=表格, 2=看板, 3=甘特, 4=日历, 5=画廊, 6=表单
    config      JSONB,             -- 筛选/排序/分组/冻结列等配置
    columns     JSONB,             -- 列顺序和属性 [{fieldId, statType, width, hidden}]
    rows        JSONB,             -- 行顺序 [{recordId}] (小量表可直接存)
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ===== 数据层 =====

-- 记录数据 (核心表)
CREATE TABLE records (
    id          UUID PRIMARY KEY,  -- 即 recordId
    table_id    UUID NOT NULL,
    data        JSONB NOT NULL,    -- {fieldId: cellValue, ...} 原始结构化数据
    stringify   JSONB,             -- {fieldId: "显示文本", ...} 文本化数据，用于搜索
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    updated_at  TIMESTAMPTZ DEFAULT NOW(),
    created_by  UUID,
    updated_by  UUID
);

-- 关键索引
CREATE INDEX idx_records_table ON records(table_id);
CREATE INDEX idx_records_data ON records USING GIN(data);  -- JSONB通用索引

-- ===== 协作层 =====

-- 操作记录 (OT/版本控制)
CREATE TABLE changesets (
    id              UUID PRIMARY KEY,
    table_id        UUID NOT NULL,
    revision        BIGINT NOT NULL,  -- 全局递增版本号
    operations      JSONB NOT NULL,   -- [{action, fieldId, recordId, before, after}]
    created_by      UUID,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ===== 分析层 (可选) =====

-- 字段级修改追踪
-- 可通过 recordMeta 或单独的审计表实现
```

### data JSONB 的结构设计

参考 APITable，每种字段类型有独立的 cellValue 结构:

```json
{
    "fld_text_001": [{"type": 1, "text": "Hello"}],
    "fld_number_002": [{"type": 1, "text": "42.5"}],
    "fld_date_003": 1655876993000,
    "fld_select_004": ["optRed123"],
    "fld_multi_select_005": ["optRed123", "optBlue456"],
    "fld_link_006": ["recAbc123", "recDef456"],
    "fld_formula_007": [{"type": 1, "text": "100"}],
    "fld_attachment_008": [
        {"id": "att123", "name": "photo.jpg", "size": 1024, "url": "..."}
    ]
}
```

---

## 四、数据分析在不同数据量级的方案

| 数据量 | 方案 | 说明 |
|--------|------|------|
| < 10万行 | PostgreSQL JSONB 直接查询 | 足够快，配合GIN索引 |
| 10万-100万行 | PostgreSQL + 函数索引 + Redis缓存 | 为高频分析字段建表达式索引 |
| 100万-1000万行 | PostgreSQL + 物化视图 + 异步聚合 | 飞书2025年方案: 数据分片+预聚合+缓存 |
| > 1000万行 | 引入OLAP引擎(ClickHouse/DuckDB) | 数据同步到列式存储做分析 |

### 分析API设计思路

```sql
-- 不直接暴露SQL给前端，而是设计分析API:
POST /api/tables/{tableId}/analytics
{
    "measures": [
        {"fieldId": "fld_number_002", "function": "SUM"},
        {"fieldId": "fld_number_003", "function": "AVG"}
    ],
    "dimensions": [
        {"fieldId": "fld_select_004"}
    ],
    "filters": [
        {"fieldId": "fld_date_003", "operator": ">=", "value": "2025-01-01"}
    ],
    "sort": [{"fieldId": "SUM_fld_number_002", "order": "desc"}]
}
```

后端将这个请求翻译为 PostgreSQL JSONB 查询或转发给 OLAP 引擎。

---

## 五、各产品实际选择

| 产品 | 数据库 | 核心方案 |
|------|--------|---------|
| Notion | PostgreSQL | Block图模型，每条Block是一个记录 |
| 飞书多维表格 | PostgreSQL + Redis | 微服务+预聚合+缓存，2025年升级到千万行 |
| APITable | PostgreSQL | Snapshot(JSONB) + Changeset + Operation |
| NocoDB | 连接已有SQL | 代理层，用户自带数据库 |
| Baserow | PostgreSQL | 自有后端 + JSONB |

## 参考链接
- [动态属性存储方案对比 - Leapcell](https://leapcell.io/blog/storing-dynamic-attributes-sparse-columns-eav-and-jsonb-explained)
- [PostgreSQL JSONB vs EAV](https://www.razsamuel.com/postgresql-jsonb-vs-eav-dynamic-data/)
- [用户自定义字段数据库设计 - Stack Overflow](https://stackoverflow.com/questions/5106335/how-to-design-a-database-for-user-defined-fields)
- [Relational vs Dimensional - Stack Overflow](https://stackoverflow.com/questions/2798595/relational-vs-dimensional-databases-whats-the-difference)
- [Notion数据库Schema - Reddit](https://www.reddit.com/r/Database/comments/1d3vdpt/what_is_the_database_schema_of_notetaking_apps/)
- [APITable Snapshot文档](https://apitable.getoutline.com/s/751b142b-866f-4174-a5f1-a2975f85ad41/doc/0x3-snapshots-3lIAWPoaIx)
- [多维表格大数据方案](https://www.finereport.com/blog/article/68b0060cd2527e0eb70227af)
