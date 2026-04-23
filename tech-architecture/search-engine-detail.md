# 搜索引擎实现深度研究

## 概述
本文档深入研究多维表格产品搜索引擎的完整实现方案，涵盖中文全文搜索、索引同步策略、相关性排序、分面搜索、跨表搜索、API设计等核心主题。基于已确定的两阶段策略（Phase 1: PostgreSQL原生 → Phase 2: Meilisearch），逐一分析技术选型和实现细节。

---

## 一、PostgreSQL 中文全文搜索

### 1.1 核心概念

PostgreSQL 全文检索围绕两个数据类型：
- **tsvector** — 文档经分词、去停用词、词形归一化后生成的词位序列（lexeme + 位置信息）
- **tsquery** — 查询词经相同处理后生成的查询表达式，支持 `&`(AND)、`|`(OR)、`!`(NOT) 和 `@@`(包含) 操作符

默认的 `simple` 配置仅按空格分词，不适合中文。需要引入中文分词扩展。

### 1.2 中文分词插件对比

| 特性 | zhparser | pg_jieba | pg_zhtrgm |
|------|----------|----------|-----------|
| 底层引擎 | SCWS (Simple Chinese Word Segmentation) | Jieba (结巴分词) | 基于 pg_trgm 的三元组 |
| 分词精度 | 中等（基于词频词典） | 较高（结巴分词生态成熟） | 低（无语义理解） |
| 自定义词典 | 支持（extra_dicts 配置） | 支持（用户词典） | 不适用 |
| 性能 | 较快 | 快 | 最快（但粒度粗） |
| 部署复杂度 | 需安装 SCWS + 编译插件 | 需编译 C++ jieba 库 | 仅需 pg_trgm 扩展 |
| 与 PG 耦合度 | 中等 | 较高 | 低 |
| 内存效率 | 每连接独立加载词典 | 每连接独立加载（可用 pg_jiebaparser 优化共享） | 不涉及 |
| 停用词支持 | 支持 | 支持 | 不适用 |
| 词性标注 | 支持（n/v/a/i/e/l/t 等词性映射） | 支持 | 不支持 |

**推荐**: zhparser — 基于 SCWS，社区成熟度更高，阿里云 PolarDB 也选用它作为默认中文分词方案，文档丰富。

### 1.3 zhparser 配置实战

```sql
-- 1. 安装扩展
CREATE EXTENSION zhparser;

-- 2. 创建中文搜索配置
CREATE TEXT SEARCH CONFIGURATION chinese_zh (PARSER = zhparser);

-- 3. 映射词性到 simple 词典
-- n=名词, v=动词, a=形容词, i=成语, e=叹词, l=习语, t=时间词素
ALTER TEXT SEARCH CONFIGURATION chinese_zh
  ADD MAPPING FOR n,v,a,i,e,l,t WITH simple;

-- 4. 验证分词效果
SELECT ts_debug('chinese_zh', '飞书多维表格是企业协作工具');
-- 结果: '飞书':n '多维':n '表格':n '是':v '企业':n '协作':v '工具':n

-- 5. 添加自定义词典（领域术语）
-- 文件路径: $PGDATA/tsearch_data/custom_dict.utf8.txt
-- 格式: word TF IDF ATTR
-- 例如: 甘特图 1 1 n
-- 然后在 postgresql.conf 中添加:
-- zhparser.extra_dicts = 'custom_dict.utf8.txt'
```

### 1.4 tsvector 索引构建策略

**方案A: 函数索引（推荐起步方案）**
```sql
-- 利用已有的 stringify 字段
CREATE INDEX idx_records_search ON records
  USING GIN (to_tsvector('chinese_zh', coalesce(stringify::text, '')));

-- 查询
SELECT * FROM records
WHERE to_tsquery('chinese_zh', '项目进度') @@
      to_tsvector('chinese_zh', coalesce(stringify::text, ''));
```

**方案B: 生成列 + 索引（更高效查询）**
```sql
ALTER TABLE records ADD COLUMN search_vector tsvector
  GENERATED ALWAYS AS (
    to_tsvector('chinese_zh', coalesce(stringify::text, ''))
  ) STORED;

CREATE INDEX idx_records_search ON records USING GIN(search_vector);

-- 查询更简洁
SELECT * FROM records
WHERE to_tsquery('chinese_zh', '项目进度') @@ search_vector;
```

**方案C: 多字段加权 tsvector（字段级权重）**
```sql
-- 为不同字段设置权重: A(标题) > B(关键字段) > C(普通字段) > D(次要字段)
ALTER TABLE records ADD COLUMN search_vector_weighted tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('chinese_zh', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('chinese_zh', coalesce(key_fields_text, '')), 'B') ||
    setweight(to_tsvector('chinese_zh', coalesce(other_fields_text, '')), 'C')
  ) STORED;
```

### 1.5 相关性排序（PostgreSQL 阶段）

PostgreSQL 内置两种排序函数：
- **ts_rank**: 基于词频匹配度排序，考虑匹配词数量和频率
- **ts_rank_cd**: 覆盖密度排序，考虑匹配词在文档中的接近程度

```sql
-- 带权重的排序查询
SELECT *, ts_rank_cd(search_vector_weighted, query) AS rank
FROM records, plainto_tsquery('chinese_zh', '项目进度') query
WHERE query @@ search_vector_weighted
ORDER BY rank DESC
LIMIT 20;
```

**局限**: PostgreSQL 的 ts_rank 不支持 IDF（逆文档频率），长文档容易被过度加权。相比 BM25 有明显不足。可考虑 pg_search / ParadeDB 的 BM25 扩展。

### 1.6 性能参考

| 操作 | 数据量 | 耗时（参考） |
|------|--------|-------------|
| GIN 索引构建 | 10万行 | ~3s |
| GIN 索引构建 | 100万行 | ~30s |
| 全文搜索查询 | 10万行 | <10ms |
| 全文搜索查询 | 100万行 | <50ms |
| ts_rank 排序查询 | 10万行 | ~20ms |

GIN 索引的 `fastupdate = on`（默认）可以显著加速写入时的索引更新，将多次更新合并为一次。

---

## 二、Meilisearch 中文搜索

### 2.1 内置 CJK 分词能力

Meilisearch 使用 charabia 作为分词库，**内置了中文（CMN）的专用分词 pipeline**：
- 底层使用 **jieba** 分词器进行中文分词
- 支持简繁转换（kvariant normalization）
- 分词性能: ~10 MiB/sec（segmentation），~5 MiB/sec（tokenization）
- 零配置，自动检测语言并应用对应的分词 pipeline

```json
// 无需额外配置，Meilisearch 自动识别中文
// 索引文档时，中文字段会自动使用 jieba 分词
{
  "title": "飞书多维表格是企业协作工具",
  // charabia 自动分词: ["飞书", "多维", "表格", "企业", "协作", "工具"]
}
```

### 2.2 中文搜索的配置优化

```json
// 1. 设置 searchableAttributes — 控制字段搜索优先级
{
  "searchableAttributes": [
    "title",      // 最高优先级
    "tableName",  // 次高
    "content",    // 第三
    "tags"        // 最低
  ]
}

// 2. 设置 separator tokens — 自定义分隔符
{
  "separatorTokens": ["|", "/", "//"]
}

// 3. 设置 dictionary — 自定义词边界
{
  "dictionary": ["甘特图", "多维表格", "看板视图"]
}

// 4. 设置 synonyms — 同义词
{
  "synonyms": {
    "多维表格": ["bitable", "多维表"],
    "看板": ["kanban", "任务板"]
  }
}

// 5. 设置 typo tolerance — 对中文关闭（中文字符不适合拼写纠错）
{
  "typoTolerance": {
    "enabled": true,
    "disableOnAttributes": ["title_cn", "content_cn"]
  }
}
```

### 2.3 Meilisearch vs Elasticsearch 中文搜索对比

| 维度 | Meilisearch | Elasticsearch |
|------|-------------|---------------|
| 中文分词 | 内置 jieba (charabia)，零配置 | 需安装 IK Analysis / jieba 插件 |
| 部署复杂度 | 单二进制文件，Docker一键部署 | 需 JVM + 集群配置，资源占用大 |
| 错字容忍 | 内置，开箱即用 | 需配置 fuzzy query |
| 搜索延迟 | 通常 <50ms | 通常 100-500ms |
| 适用数据规模 | 百万级文档 | 十亿级文档 |
| 聚合分析 | 基础 facets | 强大的 aggregation 框架 |
| 自定义评分 | 多规则 bucket sort，顺序可配 | BM25 + function_score，灵活但复杂 |
| 运维成本 | 极低 | 高（集群管理、调优） |
| 学习曲线 | 低 | 高 |
| 中文生态 | 中文文档站 meilisearch.com.cn | 中文资料丰富 |

**结论**: 对于多维表格产品（百万级数据、中文为主、快速迭代），Meilisearch 是比 Elasticsearch 更合适的选择。

### 2.4 Meilisearch 的限制与注意事项

1. **中文字符的 typo tolerance 应关闭**: 拼写纠错对中文无意义，反而可能干扰结果
2. **文档大小限制**: 单个文档不宜超过 10KB，大文本字段应在索引前截断或摘要
3. **索引总量**: 设计目标是百万级文档，超出应考虑分索引或 Elasticsearch
4. **中文简繁转换**: charabia 会将简体转为繁体做归一化，但实际搜索中简体查询可匹配繁体内容（已知 issue，需关注）
5. **自定义词典有限**: charabia 的 dictionary 设置可补充词边界，但不能像 pg_jieba 那样完全自定义分词策略

---

## 三、索引更新策略

### 3.1 Phase 1: PostgreSQL 原生索引更新

```
用户写入 → NestJS API → PostgreSQL INSERT/UPDATE
                        ↓ (自动)
                    GIN 索引更新 (fastupdate)
                        ↓ (异步合并)
                    GIN 索引优化完成
```

- GIN 索引的 `fastupdate = on` 会将 pending list 延后合并，写入性能好
- 搜索结果立即可见（因为是同一个事务）
- 一致性: **强一致**（事务内可见）

### 3.2 Phase 2: Meilisearch 索引同步

#### 方案A: 应用层双写（推荐初期）
```
用户写入 → NestJS API → PostgreSQL 写入（主）
                      → Meilisearch 索引更新（异步，不阻塞响应）
```

```typescript
// NestJS 服务层伪代码
async createRecord(data: CreateRecordDto) {
  // 1. 先写 PostgreSQL
  const record = await this.prisma.record.create({ data });

  // 2. 异步更新 Meilisearch（不阻塞响应）
  this.meiliService.indexRecord(record).catch(err => {
    this.logger.error('搜索索引更新失败', err);
    // 可加入重试队列
  });

  return record;
}
```

- 优点: 实现简单，延迟低（通常 <100ms）
- 缺点: 应用崩溃时可能丢失索引更新
- 适用于: 初期快速上线

#### 方案B: Write-Behind + Redis 队列（推荐中期）
```
用户写入 → NestJS API → PostgreSQL 写入
                      → Redis LPUSH (search:update:queue)
                        ↓
               Worker 进程消费队列 → 批量更新 Meilisearch
```

```typescript
// Producer: 写入 Redis 队列
await redis.lpush('search:update:queue', JSON.stringify({
  type: 'record.update',
  tableId: 'xxx',
  recordId: 'yyy',
  data: record
}));

// Consumer: 批量消费
async function processSearchQueue() {
  while (true) {
    const items = await redis.rpop('search:update:queue', 100); // 批量取100条
    if (items.length > 0) {
      await meiliIndex.updateDocuments(items.map(parse));
    }
    await sleep(100); // 100ms 间隔
  }
}
```

- 目标延迟: **<1秒**（批量合并写入，100ms 窗口）
- 可靠性: Redis 持久化 + 重试机制
- 批量写入优势: Meilisearch 批量 API 比 单条更新快 10-100 倍

#### 方案C: CDC 逻辑复制（推荐大规模）
```
PostgreSQL WAL (wal_level=logical)
        ↓
  wal2json 插件 / Debezium
        ↓
  meilisync / MeiliBridge
        ↓
  Meilisearch 索引更新
```

**meilisync 配置示例**:
```yaml
source:
  type: postgres
  host: localhost
  port: 5432
  user: postgres
  password: xxx
  database: bitable
  # PostgreSQL 需要: wal_level = logical, 安装 wal2json 扩展

meilisearch:
  api_url: http://localhost:7700
  api_key: xxx
  insert_size: 1000      # 累积1000条文档后批量写入
  insert_interval: 5     # 或每5秒写入一次

sync:
  - table: records
    index: bitable-records
    full: true            # 首次全量同步
    fields:
      id:
      table_id:
      stringify:
```

**MeiliBridge** (Rust 实现，更新更快的替代方案):
- 高性能异步 CDC 同步服务
- 使用 PostgreSQL 逻辑复制流式推送到 Meilisearch
- 适合数据量大、实时性要求高的场景

**CDC 方案对比**:

| 工具 | 语言 | PostgreSQL 要求 | 特点 |
|------|------|----------------|------|
| meilisync | Python | wal_level=logical + wal2json | 配置简单，有 Web 管理界面 |
| MeiliBridge | Rust | wal_level=logical | 高性能，异步优先 |
| Debezium + Kafka | Java | wal_level=logical | 企业级，需 Kafka，运维重 |
| 应用层监听 pg_notify | 任意 | - | 轻量，但不够可靠 |

### 3.3 批量导入场景

批量导入（Excel/CSV 导入万级数据）需要特殊处理：

```typescript
async function bulkImport(tableId: string, records: Record[]) {
  // 1. PostgreSQL 批量写入（使用 COPY 或批量 INSERT）
  await prisma.record.createMany({ data: records });

  // 2. Meilisearch 批量索引（使用 updateDocuments 批量 API）
  // 不逐条更新，而是在导入完成后一次性批量索引
  await meiliIndex.updateDocumentsInBatches(records, {
    batchSize: 1000  // 每批1000条
  });
}
```

### 3.4 索引新鲜度目标

| 场景 | 可接受延迟 | 推荐方案 |
|------|-----------|---------|
| 单条记录编辑 | <1秒 | 应用层异步双写 |
| 批量操作 | <5秒 | Redis 队列 + 批量写入 |
| Excel 导入 | <30秒（导入完成后） | 导入完毕触发全量索引 |
| 自动化触发更新 | <3秒 | 事件驱动 + 队列 |

---

## 四、相关性排序设计

### 4.1 PostgreSQL 阶段: ts_rank

PostgreSQL 内置 `ts_rank` / `ts_rank_cd` 的局限：
- 不考虑 IDF（逆文档频率），高频通用词权重偏高
- 长文档天然占优势
- 无法配置字段级权重（只能通过 setweight A/B/C/D 四级）

**改进方案 — pg_search (ParadeDB)**:
- 在 PostgreSQL 中实现 BM25 排名
- 支持 IDF + 文档长度归一化
- 与 JSONB 数据类型良好集成
- 可作为 Phase 1.5 考虑引入

### 4.2 Meilisearch 阶段: 多规则排序系统

Meilisearch 不使用单一 BM25 分数，而是采用**多规则桶排序（multi-criteria bucket sort）**：

```
所有匹配文档
  │
  ├─ 1. words ─────── 匹配了多少查询词？
  │     ├─ 3/3 → 桶A
  │     ├─ 2/3 → 桶B
  │     └─ 1/3 → 桶C
  │
  ├─ 2. typo ──────── 需要纠错多少次？
  │     ├─ 0次 → 子桶A.1
  │     └─ 1次 → 子桶A.2
  │
  ├─ 3. proximity ─── 匹配词之间距离多近？
  │     ├─ 相邻 → 子桶A.1.1
  │     └─ 间隔3词 → 子桶A.1.2
  │
  ├─ 4. attributeRank ─ 匹配了哪个字段？
  │     ├─ title匹配 → 更高
  │     └─ content匹配 → 更低
  │
  ├─ 5. sort ──────── 用户自定义排序
  │
  ├─ 6. wordPosition ─ 在字段中什么位置匹配？
  │     ├─ 开头匹配 → 更高
  │     └─ 末尾匹配 → 更低
  │
  └─ 7. exactness ── 精确匹配还是前缀？
        ├─ 精确 → 更高
        └─ 前缀 → 更低
```

**关键特性**: 每条规则只在前一条规则平局时才生效。高优先级的维度**无法**被低优先级的高分补偿。

### 4.3 字段级权重设计

**Meilisearch 的 searchableAttributes 顺序即权重**:
```json
{
  "searchableAttributes": [
    "recordTitle",     // 字段匹配优先级最高
    "tableName",       // 第二
    "keyFields",       // 第三
    "content",         // 第四
    "tags"             // 最低
  ]
}
```

### 4.4 时效性加权（Recency Boost）

通过自定义排序规则实现最近修改的记录排在前面：
```json
{
  "rankingRules": [
    "words",
    "typo",
    "proximity",
    "attribute",
    "sort",
    "exactness",
    "updatedAt:desc"    // 自定义规则：按更新时间倒序
  ],
  "sortableAttributes": ["updatedAt"]
}
```

在搜索时带上 sort 参数：
```json
{
  "q": "项目进度",
  "sort": ["updatedAt:desc"]
}
```

### 4.5 个性化排序（长期目标）

基于用户行为的个性化排序暂不纳入 MVP，但保留扩展空间：
- 记录用户最近访问的表（Redis sorted set）
- 搜索时给用户常访问的表的记录加权
- 可通过 Meilisearch 的自定义 ranking rules 注入 `_geo` 或自定义评分字段

---

## 五、分面搜索（Faceted Search）

### 5.1 概念与需求

分面搜索让用户在搜索结果的基础上，按字段值进一步筛选：
- 在多维表格中，用户搜索"项目"后，可以按"状态"字段（进行中/已完成/暂停）筛选
- 每个筛选选项旁显示匹配数量
- 支持多维度同时筛选

### 5.2 Meilisearch 分面实现

**配置 filterableAttributes**:
```json
{
  "filterableAttributes": [
    "status",
    "priority",
    "assignee",
    "tags",
    "tableId",
    "createdBy"
  ]
}
```

**搜索时请求分面分布**:
```json
{
  "q": "项目",
  "facets": ["status", "priority", "assignee"]
}
```

**响应包含分面统计**:
```json
{
  "hits": [...],
  "facetDistribution": {
    "status": {
      "进行中": 15,
      "已完成": 8,
      "暂停": 3
    },
    "priority": {
      "高": 10,
      "中": 12,
      "低": 4
    }
  },
  "facetStats": {
    "priority": {
      "min": 1,
      "max": 3
    }
  }
}
```

**带筛选的搜索**:
```json
{
  "q": "项目",
  "filter": "status = '进行中' AND priority = '高'",
  "facets": ["status", "priority", "assignee"]
}
```

### 5.3 从 JSONB 动态生成分面

多维表格的字段是用户自定义的，分面字段不能硬编码。设计思路：

```typescript
// 1. 获取表的字段配置（确定哪些字段可用于分面）
const fields = await getTableFields(tableId);
const facetFields = fields
  .filter(f => ['select', 'multiSelect', 'user', 'checkbox', 'number'].includes(f.type))
  .map(f => `field_${f.id}`);

// 2. 在 Meilisearch 中设置 filterableAttributes
await meiliIndex.updateSettings({
  filterableAttributes: ['tableId', ...facetFields]
});

// 3. 搜索时动态指定 facets
const results = await meiliIndex.search(query, {
  filter: `tableId = '${tableId}'`,
  facets: facetFields.slice(0, 10)  // 最多10个分面维度
});
```

### 5.4 Phase 1: PostgreSQL 分面

在 PostgreSQL 阶段，使用 JSONB 查询 + 聚合实现分面：

```sql
-- 搜索 + 按状态字段分面计数
SELECT
  data->>'fld_status' AS status,
  COUNT(*) AS count
FROM records
WHERE table_id = 'xxx'
  AND search_vector @@ to_tsquery('chinese_zh', '项目')
GROUP BY data->>'fld_status';
```

### 5.5 分面搜索 UI 模式

```
┌──────────────────────────────────────────────┐
│ 🔍 搜索: 项目                                │
├──────────────────────────────────────────────┤
│ 筛选条件:                                    │
│                                              │
│ 状态                          │
│   进行中 (15)  [✓]                           │
│   已完成 (8)   [ ]                           │
│   暂停 (3)     [ ]                           │
│                                              │
│ 优先级                        │
│   高 (10)  [✓]                               │
│   中 (12)  [ ]                               │
│   低 (4)   [ ]                               │
│                                              │
│ 负责人                          │
│   张三 (5)   [ ]                             │
│   李四 (3)   [ ]                             │
│   ...                                        │
├──────────────────────────────────────────────┤
│ 搜索结果: 15条                               │
│ 1. 项目A - 进行中 - 高优先级                  │
│ 2. 项目B - 进行中 - 高优先级                  │
│ ...                                          │
└──────────────────────────────────────────────┘
```

---

## 六、跨表搜索

### 6.1 需求场景

- **全局搜索**: 用户在工作空间内搜索关键字，需返回所有表中匹配的记录
- **Quick Find**: 类似 Notion 的快速查找（Cmd+K），跨所有表搜索
- **结果展示**: 按表分组显示，或混合排序后统一展示

### 6.2 索引设计

#### 方案A: 统一索引（推荐）
```
Meilisearch Index: workspace_{id}_all
├── 所有表的记录文档，统一索引
├── 每条文档包含: recordId, tableId, tableName, 字段文本, updatedAt
└── 通过 filter: tableId 分组
```

```json
// 索引中的文档结构
{
  "id": "rec_001",
  "tableId": "tbl_project",
  "tableName": "项目列表",
  "recordTitle": "Q2产品规划",
  "content": "Q2产品规划 进行中 高优先级 张三...",
  "tags": ["产品", "规划"],
  "status": "进行中",
  "priority": "高",
  "updatedAt": 1713849600,
  "createdBy": "user_001"
}
```

**searchableAttributes 配置**:
```json
{
  "searchableAttributes": [
    "recordTitle",
    "tableName",
    "content",
    "tags"
  ]
}
```

#### 方案B: 每表一个索引
```
Meilisearch Indices:
├── table_{tbl_id}_records
├── table_{tbl_id}_records
└── ...
```
- 优点: 各表字段独立，筛选精确
- 缺点: 跨表搜索需要多索引并行查询，合并排序复杂

**推荐方案A**，跨表搜索更简单高效。

### 6.3 跨表搜索结果排序

异构 Schema 下的排序挑战：不同表的字段含义不同，不能简单比较。

**排序策略**:
1. **文本相关度**: 由 Meilisearch 的 ranking rules 统一处理
2. **表名匹配加权**: tableName 字段参与搜索，如果表名匹配则该表结果更靠前
3. **时效性加权**: updatedAt:desc 规则
4. **分组展示**: 前端按 tableId 分组，每组内按相关度排序

### 6.4 统一搜索 API 设计

```
POST /api/workspaces/:workspaceId/search

请求体:
{
  "q": "项目进度",
  "scope": "all",              // all | table | field
  "tableId": null,             // scope=table 时指定
  "filters": {                 // 可选筛选
    "status": ["进行中", "待开始"],
    "priority": ["高"]
  },
  "sort": "relevance",         // relevance | updatedAt
  "limit": 20,
  "offset": 0
}

响应体:
{
  "query": "项目进度",
  "totalHits": 45,
  "hits": [
    {
      "recordId": "rec_001",
      "tableId": "tbl_project",
      "tableName": "项目列表",
      "recordTitle": "Q2产品规划",
      "highlight": {
        "recordTitle": "<em>项目</em><em>进度</em>跟踪表",
        "content": "...Q2<em>项目</em>的<em>进度</em>更新..."
      },
      "_rankingScore": 0.92
    }
  ],
  "facetDistribution": {
    "tableId": {
      "tbl_project": 20,
      "tbl_task": 15,
      "tbl_meeting": 10
    }
  },
  "processingTimeMs": 12
}
```

### 6.5 搜索结果展示模式

**模式A: 按表分组**
```
搜索 "项目进度" (45条结果)

📋 项目列表 (20条)
  ├─ Q2产品规划 - 进行中
  ├─ Q1项目总结 - 已完成
  └─ 更多...

✅ 任务跟踪 (15条)
  ├─ 项目进度更新-Week15
  ├─ 进度评审会议纪要
  └─ 更多...

📅 会议记录 (10条)
  ├─ 项目进度周会 4/15
  └─ 更多...
```

**模式B: 混合时间线**
```
搜索 "项目进度" (45条结果)

10:30  Q2产品规划 - 项目列表
10:15  项目进度更新-Week15 - 任务跟踪
09:45  项目进度周会 4/15 - 会议记录
...
```

---

## 七、搜索 API 设计

### 7.1 API 端点设计

| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/workspaces/:id/search` | POST | 全局搜索 |
| `/api/tables/:id/search` | POST | 表内搜索 |
| `/api/tables/:id/suggest` | GET | 搜索建议/自动补全 |
| `/api/workspaces/:id/search/stats` | GET | 搜索分析统计 |

### 7.2 全局搜索请求/响应

```
POST /api/workspaces/:workspaceId/search

请求:
{
  "q": "项目",
  "limit": 20,
  "offset": 0,
  "filters": ["tableId = 'tbl_xxx'"],     // 可选
  "facets": ["tableId", "status"],          // 可选
  "sort": ["updatedAt:desc"],               // 可选
  "attributesToHighlight": ["recordTitle", "content"],
  "attributesToRetrieve": ["recordId", "tableId", "tableName", "recordTitle", "updatedAt"]
}

响应:
{
  "hits": [...],
  "query": "项目",
  "processingTimeMs": 5,
  "hitsPerPage": 20,
  "page": 1,
  "totalHits": 45,
  "totalPages": 3,
  "facetDistribution": {...}
}
```

### 7.3 表内搜索

```
POST /api/tables/:tableId/search

请求:
{
  "q": "张三",
  "filters": ["status = '进行中'", "priority > 2"],
  "facets": ["status", "assignee"],
  "sort": ["updatedAt:desc"],
  "limit": 50,
  "offset": 0,
  "attributesToHighlight": ["*"]
}
```

### 7.4 分页策略

**Phase 1 (PostgreSQL)**: offset-based
```sql
SELECT * FROM records
WHERE search_vector @@ to_tsquery('chinese_zh', '项目')
ORDER BY ts_rank(search_vector, query) DESC
LIMIT 20 OFFSET 0;
```

**Phase 2 (Meilisearch)**: 两种模式
- **offset/limit**: 适合"上一页/下一页"模式（推荐，性能好）
- **page/hitsPerPage**: 适合跳页模式（会计算精确总数，性能较差）

```json
// 模式1: offset/limit（推荐）
{ "q": "项目", "limit": 20, "offset": 0 }

// 模式2: page/hitsPerPage
{ "q": "项目", "page": 1, "hitsPerPage": 20 }
```

### 7.5 搜索结果高亮

Meilisearch 内置高亮支持，通过 `attributesToHighlight` 参数配置：

```json
{
  "q": "项目进度",
  "attributesToHighlight": ["recordTitle", "content"]
}
```

响应中返回 `_formatted` 字段：
```json
{
  "recordTitle": "项目进度跟踪表",
  "_formatted": {
    "recordTitle": "<em>项目</em><em>进度</em>跟踪表"
  }
}
```

可自定义高亮标签：
```json
{
  "attributesToHighlight": ["recordTitle"],
  "highlightPreTag": "<mark>",
  "highlightPostTag": "</mark>"
}
```

### 7.6 搜索建议/自动补全

**方案A: Meilisearch 前缀搜索（Phase 2）**

Meilisearch 自动支持前缀搜索（最后一个查询词作为前缀匹配）：
```json
{
  "q": "项目",  // 自动匹配 "项目进度"、"项目管理" 等
  "limit": 5
}
```

**方案B: Redis 前缀树（Phase 1/补充）**

```typescript
// 维护搜索词热度 ZSET
await redis.zincrby('search:popular', 1, '项目进度');

// 获取热门搜索建议
const suggestions = await redis.zrevrange('search:popular', 0, 9);

// 前缀匹配（使用 Redis SORT 命令或专门的前缀索引）
```

**方案C: PostgreSQL 前缀匹配**
```sql
-- 使用 pg_trgm 进行模糊前缀匹配
SELECT DISTINCT word FROM search_suggestions
WHERE word % '项目'  -- 相似度匹配
ORDER BY similarity(word, '项目') DESC
LIMIT 10;
```

### 7.7 搜索分析

记录搜索行为用于优化：

```typescript
interface SearchEvent {
  query: string;
  userId: string;
  workspaceId: string;
  resultCount: number;    // 0 表示零结果搜索
  clickedRecordId?: string;
  timestamp: Date;
  processingTimeMs: number;
}
```

**关键指标**:
- **热门搜索词**: Redis sorted set 或 PostgreSQL 聚合
- **零结果搜索**: 发现内容缺口，优化索引
- **搜索无点击**: 排序质量差，需调优
- **平均搜索延迟**: 监控搜索性能

```sql
-- 零结果搜索词统计
SELECT query, COUNT(*) as zero_count
FROM search_events
WHERE result_count = 0
GROUP BY query
ORDER BY zero_count DESC
LIMIT 20;
```

---

## 八、JSONB 特定搜索优化

### 8.1 GIN 索引策略

```sql
-- 1. jsonb_path_ops — 精确包含查询（索引最小，查询最快）
CREATE INDEX idx_records_data ON records USING GIN (data jsonb_path_ops);
-- 适用: WHERE data @> '{"fld_status": "进行中"}'

-- 2. jsonb_ops (默认) — 支持键存在和包含查询
CREATE INDEX idx_records_data_full ON records USING GIN (data);
-- 适用: WHERE data ? 'fld_status' / data @> '...' / data @? '$.fld_status'

-- 3. 表达式索引 — 特定 JSONB 路径
CREATE INDEX idx_records_status ON records ((data->>'fld_status'));
-- 适用: WHERE data->>'fld_status' = '进行中' ORDER BY ...
```

### 8.2 组合 tsvector + JSONB 查询

```sql
-- 全文搜索 + JSONB 字段筛选组合
SELECT *
FROM records
WHERE table_id = 'tbl_xxx'
  AND search_vector @@ to_tsquery('chinese_zh', '项目')
  AND data @> '{"fld_status": "进行中"}'::jsonb
  AND (data->>'fld_priority')::int > 2
ORDER BY ts_rank(search_vector, query) DESC;
```

**索引组合**: GIN(tsvector) + GIN(jsonb_path_ops) + B-tree(table_id)，PostgreSQL 可以组合使用多个索引。

### 8.3 JSONB 字段排序优化

```sql
-- 问题: WHERE + ORDER BY JSONB 字段性能差
-- 解决: 表达式索引

-- 为常用排序字段创建表达式索引
CREATE INDEX idx_records_priority ON records ((data->>'fld_priority'));
CREATE INDEX idx_records_updated ON records ((data->>'updatedAt'));

-- 带排序的查询现在可走索引
SELECT * FROM records
WHERE table_id = 'tbl_xxx'
ORDER BY (data->>'fld_priority') DESC;
```

### 8.4 JSONB WHERE + ORDER BY 性能要点

| 查询类型 | 索引 | 性能 |
|----------|------|------|
| `data @> '{"key":"val"}'` | GIN(jsonb_path_ops) | 快 |
| `data->>'key' = 'val'` | 表达式 B-tree | 快 |
| `data->>'key' LIKE '%val%'` | pg_trgm GIN | 中等 |
| `WHERE + ORDER BY jsonb字段` | 表达式 B-tree + table_id 组合索引 | 快 |
| `tsvector全文 + jsonb筛选` | GIN(tsvector) + GIN(jsonb) | 快（BitmapAnd） |

### 8.5 stringify 字段的搜索优化

APITable 的 stringify 思路——每条记录预存所有字段的文本化版本：

```sql
-- stringify 是 JSONB 字段，存储所有可搜索文本
-- 例如: {"text": "张三 项目进度 高 进行中 2024-01-15 ..."}

-- 全文搜索索引
CREATE INDEX idx_records_stringify ON records
  USING GIN (to_tsvector('chinese_zh', stringify::text));

-- ILIKE 模糊搜索（小数据量备选）
CREATE INDEX idx_records_stringify_trgm ON records
  USING GIN (stringify::text gin_trgm_ops);
-- 需要 pg_trgm 扩展
```

---

## 九、实施路线图

### Phase 1: PostgreSQL 原生搜索（MVP）

**范围**: 单表搜索 + 简单全局搜索

```
Week 1-2:
├── 安装 zhparser 扩展 + 创建 chinese_zh 配置
├── 创建 search_vector 生成列 + GIN 索引
├── 实现 /api/tables/:id/search 端点
└── 添加自定义词典（业务术语）

Week 3-4:
├── 实现全局搜索（UNION ALL 多表查询）
├── 搜索建议（pg_trgm 前缀匹配）
├── 搜索事件记录表
└── 前端搜索 UI（搜索栏 + 结果列表）
```

**依赖**: zhparser/pg_jieba 扩展, pg_trgm

### Phase 2: Meilisearch（增长期）

**范围**: 全局搜索 + 分面搜索 + 跨表搜索

```
Week 1-2:
├── 部署 Meilisearch（Docker）
├── 设计统一索引结构（workspace_{id}_all）
├── 实现数据同步（应用层双写）
└── 配置中文搜索（searchableAttributes, synonyms）

Week 3-4:
├── 实现分面搜索 API
├── 跨表搜索 + 结果分组
├── 搜索高亮 + 自动补全
├── 搜索分析（热门词、零结果词）
└── 前端搜索体验升级
```

**迁移**: 从 PG tsvector 切换到 Meilisearch，保留 PG 搜索作为降级方案

### Phase 3: 搜索增强（可选）

```
├── 引入 CDC 同步（meilisync / MeiliBridge）替代应用层双写
├── 搜索结果个性化（基于用户行为加权）
├── AI 搜索增强（自然语言查询 → 搜索条件）
├── 搜索性能监控面板
└── 考虑 pg_search (ParadeDB BM25) 作为 PG 搜索增强
```

---

## 参考链接

### PostgreSQL 中文全文搜索
- [PostgreSQL 全文搜索官方文档](https://www.postgresql.org/docs/current/textsearch.html)
- [zhparser - PostgreSQL 中文分词插件](https://github.com/amutu/zhparser)
- [pg_jieba - 结巴分词 PostgreSQL 插件](https://github.com/jaiminpan/pg_jieba)
- [在 PostgreSQL 数据库使用中文全文搜索 - 掘金](https://juejin.cn/post/7282170455683301434)
- [PostgreSQL 全文检索深度指南 - 知乎](https://zhuanlan.zhihu.com/p/2025590075426088192)
- [PostgreSQL 分词搜索：pg_jieba 与 zhparser 方案解析 - 百度智能云](https://cloud.baidu.com/article/2827093)
- [PolarDB PostgreSQL 全文检索功能 - 阿里云](https://help.aliyun.com/zh/polardb/polardb-for-postgresql/full-text-search-introduction/)
- [PostgreSQL 全文检索实战：GIN索引优化到中文分词避坑指南 - CSDN](https://blog.csdn.net/read5/article/details/153663730)
- [PostgreSQL 全文检索/倒排索引插件集合 - 博客园](https://www.cnblogs.com/xibuhaohao/articles/18872490)
- [见招拆招 - PostgreSQL 中文全文索引效率优化 - 掘金](https://juejin.cn/post/6844903548853960712)
- [pg_jiebaparser - 优化内存使用的中文分词](https://github.com/hyz1840/pg_jiebaparser)
- [pg_search / ParadeDB - PostgreSQL BM25](https://docs.paradedb.com/legacy/indexing/tokenizers)

### Meilisearch 中文搜索
- [Meilisearch 官方文档 - Tokenization](https://www.meilisearch.com/docs/learn/engine/language)
- [Meilisearch 官方文档 - Ranking Rules](https://meilisearch.com/docs/capabilities/full_text_search/relevancy/ranking_rules)
- [Meilisearch 排名系统深度解析 - 官方文档](https://meilisearch.com/docs/resources/internals/ranking)
- [charabia - Meilisearch 分词库 (Rust)](https://github.com/meilisearch/charabia)
- [Meilisearch 中文讨论 - Chinese Language Support](https://github.com/orgs/meilisearch/discussions/503)
- [Meilisearch 中文文档站](https://meilisearch.com.cn/)
- [Meilisearch vs Elasticsearch 对比 - 腾讯云](https://cloud.tencent.com/developer/article/2440704)
- [Meilisearch vs Elasticsearch 对比 - 掘金](https://juejin.cn/post/7325131333965496357)
- [Elasticsearch 替代方案 - Meilisearch 中文站](https://meilisearch.com.cn/blog/elasticsearch-alternatives)

### 索引同步
- [meilisync - PostgreSQL/MySQL/MongoDB → Meilisearch 实时同步](https://github.com/long2ice/meilisync)
- [MeiliBridge - PostgreSQL → Meilisearch CDC 同步](https://www.reddit.com/r/rust/comments/1modvi1/built_meilibridge_realtime_postgresql_meilisearch/)
- [Debezium PostgreSQL Connector](https://debezium.io/documentation/reference/1.9/connectors/postgresql.html)
- [PostgreSQL CDC Setup with wal2json - OLake](https://olake.io/docs/connectors/postgres/wal2json_plugin)
- [Change Data Capture in PostgreSQL - Microsoft](https://techcommunity.microsoft.com/blog/adforpostgresql/change-data-capture-in-postgres-how-to-use-logical-decoding-and-wal2json/1396421)
- [Full-Text Search with MeiliSearch and PostgreSQL tsvector](https://dev.to/myougatheaxo/full-text-search-with-claude-code-meilisearch-and-postgresql-tsvector-17ld)

### JSONB 索引优化
- [PostgreSQL GIN 索引详解 - pganalyze](https://pganalyze.com/blog/gin-index)
- [PostgreSQL JSONB GIN 索引性能优化 - dev.to](https://dev.to/polliog/postgresql-jsonb-gin-indexes-why-your-queries-are-slow-and-how-to-fix-them-12a0)
- [PostgreSQL JSONB 查询与索引 - OneUptime](https://oneuptime.com/blog/post/2026-01-26-jsonb-querying-indexing-postgresql/view)
- [JSONB Operator Classes 对比 - Medium](https://medium.com/@josef.machytka/postgresql-jsonb-operator-classes-of-gin-indexes-and-their-usage-0bf399073a4c)
- [PostgreSQL JSONB 索引策略 - dev.to](https://dev.to/philip_mcclarence_2ef9475/postgresql-jsonb-indexing-gin-expression-partial-index-strategies-i11)
- [GIN 索引全指南 - Medium](https://medium.com/@vedantthakkar1003/mastering-postgresql-gin-indexes-the-ultimate-guide-to-faster-jsonb-array-and-full-text-search-f1f8ec3e67af)

### Meilisearch 功能
- [Meilisearch 分面搜索 - 官方文档](https://meilisearch.com/docs/capabilities/filtering_sorting_faceting/how_to/filter_with_facets)
- [Meilisearch 分页 - 官方文档](https://meilisearch.com/docs/capabilities/full_text_search/how_to/paginate_search_results)
- [Meilisearch 容错设置 - 中文文档](https://meilisearch.com.cn/docs/learn/relevancy/typo_tolerance_settings)
- [Meilisearch 排序和过滤 - 官方文档](https://meilisearch.com/docs/capabilities/filtering_sorting_faceting/overview)
- [Meilisearch 分面和过滤器完整指南 - AdminDex](https://admindex.com/blog/meilisearch-facets-and-filters)

### 搜索 API 与分析
- [搜索即服务 - Meilisearch Blog](https://www.meilisearch.com/blog/search-as-a-service)
- [Autocomplete 搜索建议 - Algolia](https://www.algolia.com/blog/ux/autocomplete-how-search-suggestions-increase-conversions)
- [Redis 实现自动补全 - OneUptime](https://oneuptime.com/blog/post/2026-01-21-redis-autocomplete-implementation/view)
- [搜索建议最佳实践 - Baymard](https://baymard.com/blog/offer-autocomplete-suggestions-for-misspellings)
