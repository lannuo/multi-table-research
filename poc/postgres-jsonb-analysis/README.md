# PoC 2: PostgreSQL JSONB vs 物理表 — 数据模型方案对比

> 注：本 PoC 不做本地 benchmark（单机测试结果无法代表生产环境）。改为基于社区已在生产环境中验证的数据、已知 benchmark、以及生产案例进行分析对比。

---

## 一、JSONB 性能特征（基于 1M 行实测数据）

### 1.1 JSONB vs JSON（Source: dev.to 2025, PostgreSQL 16）

| 指标 | JSON | JSONB |
|------|------|------|
| Insert 速度 | 8.6s | 11.3s (~31% slower) |
| Key 提取 (->>) | baseline | **6.2x faster** |
| 嵌套字段访问 | baseline | **7.6x faster** |
| 数组操作 | baseline | **7.3x faster** |
| 部分更新 | baseline | **~71% faster** |
| 存储 (1M rows) | ~1,200 MB | **888 MB (26% smaller)** |

### 1.2 GIN vs B-tree vs 无索引（Source: SitePoint 2024, PG 16.3）

1M 行，~500-byte JSONB docs:

| Query Type | No Index | GIN (jsonb_path_ops) | B-tree Expression |
|---|---|---|---|
| Containment (@>) | 285ms | **0.9ms** | N/A |
| Key equality (->>) | 268ms | N/A* | **0.08ms** |
| Range scan (numeric) | 312ms | N/A | **4.5ms** |
| Index Size | 0 | 78 MB | **21 MB** |
| Insert Overhead | baseline | +29% | **+8%** |

> *GIN 索引**不加速 `->>` 提取查询** — 这是 JSONB 索引最常见的误解。

### 1.3 JSONB 冷/热缓存性能（Source: GitHub Gist, PG 15.6）

| Index Strategy | Cold Cache | Warm Cache |
|---|---|---|
| No index (->/->>) | 3,041ms | 397ms |
| GIN (jsonb_path_ops) | **3.8ms** | **0.076ms** |
| B-tree expression | 5.98ms | 0.077ms |

---

## 二、JSONB 的关键限制

Source: Heap/Contentsquare (2024) "When to Avoid JSONB"

| 限制 | 影响 |
|------|------|
| **无列级统计信息** | PG planner 对 JSONB 内部使用硬编码 0.1% 选择性估计，可能导致嵌套循环连接灾难（**2000x 慢于规范化表**） |
| **无法做 Index-Only Scan** | 即使有表达式索引，也必须在 heap 中读原始数据 |
| **GIN 不支持 ORDER BY** | GIN 用 Bitmap Index Scan，不保留行序。结合排序时要么全表扫描，要么内存排序 |
| **无外键约束** | JSONB 内部无法建立引用完整性 |
| **存储开销** | 1M 行测试：JSONB 164MB vs 规范化表 79MB（**>2x**，因 key 字符串重复） |
| **无 Schema 约束** | 全部依赖应用层校验 |

### 2.1 GIN + ORDER BY 的真实问题

5M 行实际案例（Stack Overflow）：

```sql
SELECT * FROM node
WHERE node_type_id = '2'
  AND properties @> '{"slug":"wild-castles"}'::JSONB
ORDER BY id ASC LIMIT 10;
-- 结果: ~20 秒！
```

去掉 `ORDER BY` 后降到毫秒级。GIN 不能返回排序结果，这是 JSONB 查询最常见的性能陷阱。

---

## 三、JSONB vs 规范化表：500K 行对比

Source: Mirakl Engineering, PostgreSQL 12.8

| 场景 | 规范化表 | JSONB | 胜出 |
|------|---------|------|------|
| Filter by author + adaptation | **110ms** | 120ms | 打平 |
| Order by complex CASE logic | 10,129ms | **6,676ms** | **JSONB (1.5x)** |
| Select adaptation data | **3,960ms** | 5,101ms | 规范化 (1.3x) |
| Aggregate all book data | 61,074ms | **2,234ms** | **JSONB (27x!!)** |
| Complex filter + aggregate | 3,960ms | **3,330ms** | **JSONB** |

关键规律：**JSONB 在"取全部数据"场景完胜，规范化表在"切片后做过滤"场景有优势。**

---

## 四、生产案例：Benchling EAV → JSONB 迁移

Source: Benchling Engineering

| 指标 | EAV | JSONB | 提升 |
|------|-----|------|------|
| Result ingestion speed | baseline | — | **7x faster** |
| Data warehouse mapping | baseline | — | **33% faster** |
| Sequence update lookup | baseline | — | **60% faster** |
| Entity queries | baseline | — | **~2x faster** |

注：这是 EAV→JSONB，不是规范化表→JSONB。

---

## 五、结论与建议

### 5.1 JSONB 适用场景

- Schema 频繁变化（每周新增字段）— 无需 DDL migration
- "写一次，读整体" 的模式 — 如订单快照、webhook payload
- 原型阶段，Schema 未稳定
- 字段数量极其不固定（每行可能有不同的字段组合）

### 5.2 物理表适用场景

- 需要一致的报表、仪表盘、导出
- 需要数据库约束（NOT NULL、UNIQUE、FOREIGN KEY）
- 频繁按特定字段筛选/排序/聚合
- 多服务/团队读写同一数据
- 受监管/审计环境

### 5.3 推荐方案：混合模型

```sql
CREATE TABLE records (
    id          UUID PRIMARY KEY,
    table_id    UUID NOT NULL REFERENCES tables(id),  -- 物理列
    created_by  UUID NOT NULL,                         -- 物理列
    created_at  TIMESTAMPTZ DEFAULT now(),             -- 物理列
    updated_at  TIMESTAMPTZ DEFAULT now(),             -- 物理列
    version     INT DEFAULT 1,                         -- 乐观锁
    data        JSONB NOT NULL DEFAULT '{}',           -- 动态字段值
    search_text TSVECTOR                                -- 全文搜索
);

-- 物理列用标准 B-tree 索引
CREATE INDEX idx_records_table ON records(table_id);
CREATE INDEX idx_records_created ON records(created_at);

-- JSONB 动态字段用 GIN 索引
CREATE INDEX idx_records_data ON records USING GIN (data jsonb_path_ops);
```

### 5.4 决策矩阵

| 场景 | 推荐 |
|------|------|
| MVP 期，字段类型不稳定 | JSONB — 灵活迭代，快速验证 |
| 需要频繁按某字段筛选/排序 | 将高频字段提升为物理列 + B-tree 索引 |
| 需要全文搜索 | JSONB + GIN 索引 或独立 tsvector 列 |
| 100 万行+ | 混合模型 — 核心字段物理化 + 其余 JSONB |
| 1000 万行+ | 混合模型 + 表分区 + 冷热分离 |

### 5.5 对我们项目的直接影响

基于这些数据，**MVP 阶段推荐 JSONB 混合方案**（非纯 JSONB，非纯物理表）：

1. 核心字段（id, table_id, created_by, created_at, updated_at, version）→ **物理列**
2. 动态字段值 → **JSONB data 列**，配合 GIN index
3. 索引策略：`jsonb_path_ops` GIN（比默认 jsonb_ops 小 40%）
4. 如果某个动态字段需要频繁排序/筛选 → **提升为物理列**或**表达式索引**

**对比我们当前调研中已有数据模型的建议**：APITable 的纯 JSONB 方案可行，但加上物理列辅助可以显著提升查询体验。Teable 的纯物理表方案对 Schema 灵活性限制太大，不适合 MVP 快速迭代。

---

## 参考链接

- [SitePoint: PostgreSQL JSONB Performance Guide (2024)](https://www.sitepoint.com/postgresql-jsonb-query-performance-indexing/)
- [dev.to: JSON vs JSONB - 1M rows tested (2025)](https://dev.to/ineron/json-vs-jsonb-in-postgresql-i-tested-1m-rows-to-find-ou-3cdj)
- [Heap/Contentsquare: When to Avoid JSONB (2024)](https://contentsquare.com/blog/when-to-avoid-jsonb-in-a-postgresql-schema/)
- [AppMaster: PostgreSQL JSONB vs normalized tables (2025)](https://appmaster.io/blog/postgresql-jsonb-vs-normalized-tables)
- [Mirakl Engineering: How JSONB can improve queries (2024)](https://mirakl.tech/how-jsonb-can-improve-your-postgresql-queries-90f6ed0c2f92)
- [Depesz: json vs jsonb, pglz vs lz4 (2025)](https://www.depesz.com/2025/11/29/using-json-json-vs-jsonb-pglz-vs-lz4-key-optimization-parsing-speed/)
- [Benchling: EAV → JSONB Migration](https://www.cnblogs.com/qife122/p/19165008)
