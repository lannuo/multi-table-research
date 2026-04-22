# 搜索引擎方案设计

## 需求分析
多维表格的搜索需求:
- **全局搜索**: 跨表搜索关键字（类似Notion的Quick Find）
- **表内搜索**: 单表内筛选和搜索
- **字段搜索**: 按特定字段搜索
- **实时性**: 数据变更后立即可搜索

## 方案对比

### 方案A: PostgreSQL原生全文搜索
```sql
-- 利用 stringify JSONB 字段做全文搜索
-- stringify 已预先存储所有字段的文本表示
SELECT * FROM records
WHERE table_id = 'xxx'
  AND stringify::text ILIKE '%关键词%';

-- 或使用 tsvector 全文索引
ALTER TABLE records ADD COLUMN search_vector tsvector
  GENERATED ALWAYS AS (
    to_tsvector('simple', coalesce(stringify::text, ''))
  ) STORED;

CREATE INDEX idx_search ON records USING GIN(search_vector);
```

| 优点 | 缺点 |
|------|------|
| 无额外组件 | 中文分词需要额外配置 |
| 数据一致性强 | 大数据量性能一般 |
| 运维简单 | 不支持模糊搜索/错字容忍 |

### 方案B: Elasticsearch
- **同步方式**: Debezium CDC → Kafka → Elasticsearch
- 或: 应用层双写
- **优点**: 强大的搜索能力，聚合分析
- **缺点**: 运维复杂，资源消耗大

### 方案C: Meilisearch (推荐)
- **同步方式**: meilisync (PostgreSQL CDC → Meilisearch) 或 应用层推送
- **优点**:
  - 部署简单（单二进制文件）
  - 错字容忍(Typo tolerance)开箱即用
  - 中文支持好
  - 搜索速度快
  - API简单
- **缺点**: 不适合复杂聚合分析

## 推荐策略: 分阶段引入

### 阶段1: PostgreSQL原生
- 利用 `stringify` JSONB字段 + `ILIKE` / `tsvector`
- 适合初期数据量不大（<10万行）
- 使用APITable的stringify思路: 每条记录预存文本化版本

### 阶段2: Meilisearch
- 数据量增长后引入
- 使用 meilisync 实时同步
- 提供更好的搜索体验(错字容忍、高亮、排序)

### 阶段3: Elasticsearch (可选)
- 如需复杂搜索和聚合分析
- 适合大规模企业部署

## APITable的搜索设计借鉴
- **data**: 结构化数据（精确匹配、范围查询）
- **stringify**: 文本化数据（全文搜索、模糊匹配）
- 分离存储让搜索和计算走不同路径

## 实时同步方案对比
| 方案 | 实时性 | 一致性 | 复杂度 |
|------|--------|--------|--------|
| 应用层双写 | 高 | 最终一致 | 低 |
| PostgreSQL触发器+pg_notify | 高 | 最终一致 | 中 |
| Debezium CDC | 高 | 强一致 | 高 |
| meilisync | 高 | 最终一致 | 低 |

## 参考链接
- [PostgreSQL全文搜索 - 官方文档](https://www.postgresql.org/docs/current/textsearch.html)
- [Meilisearch](https://www.meilisearch.com/)
- [meilisync - PG到Meilisearch同步](https://github.com/long2ice/meilisync)
- [Debezium CDC](https://debezium.io/)
- [ZomboDB - PG+ES桥接](https://github.com/zombodb/zombodb)
