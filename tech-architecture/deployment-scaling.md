# 部署方案与数据库扩展策略

## 部署模式

### 模式1: SaaS (软件即服务)
- 多租户共享同一套服务
- 用户无需部署，开箱即用
- 运维成本由服务商承担
- 适合: 面向公众的服务

### 模式2: 私有化部署 (Self-hosted)
- 用户在自己的服务器上部署
- 数据完全自主可控
- 单租户，无需多租户隔离
- 适合: 政府、金融、大企业

### 模式3: 混合模式
- SaaS版提供基础服务
- 企业版提供私有化部署选项
- 数据可在SaaS和私有环境间迁移

### 推荐策略
既然目标是**替代公司所有系统**，建议:
1. **初期**: 单租户私有化部署（公司内部使用）
2. **中期**: 多租户支持（如需给多个子公司/部门使用）
3. **长期**: 可选SaaS化

## 容器化部署

### Docker Compose (开发/小规模)
```yaml
services:
  web:
    image: multi-table/web
    ports: ["3000:3000"]
  api:
    image: multi-table/api
    ports: ["4000:4000"]
  postgres:
    image: postgres:16
    volumes: ["pgdata:/var/lib/postgresql/data"]
  redis:
    image: redis:7-alpine
  minio:
    image: minio/minio
    command: server /data
```

### Kubernetes (生产/大规模)
```
关键组件:
  - Ingress Controller (流量入口)
  - API Pods (HPA水平伸缩)
  - Worker Pods (后台任务)
  - PostgreSQL StatefulSet (主从)
  - Redis StatefulSet
  - PVC (持久化存储)
  - ConfigMap/Secret (配置管理)
```

## 数据库扩展策略

### PostgreSQL分区 (Partitioning)
适合单机内的性能优化:
```sql
-- 按table_id分区 (每个数据表的记录分到不同分区)
CREATE TABLE records (
    id UUID,
    table_id UUID,
    data JSONB,
    ...
) PARTITION BY HASH (table_id);

-- 或按时间范围分区
CREATE TABLE records_2025_01 PARTITION OF records
    FOR VALUES FROM ('2025-01-01') TO ('2025-02-01');
```

| 分区策略 | 适用场景 |
|----------|----------|
| HASH分区 | 按table_id均匀分布 |
| RANGE分区 | 按时间范围（适合历史数据归档） |
| LIST分区 | 按space_id隔离 |

### Citus扩展 (分布式PostgreSQL)
- PostgreSQL扩展，将PG变成分布式数据库
- 自动分片 + 协调节点
- 对应用透明，SQL语法不变
- 适合: 单表数据量超过5000万行

### 扩展路线图

```
阶段1: 单机PostgreSQL
  - 够用到百万行级别
  - 合理的索引和查询优化

阶段2: PostgreSQL分区
  - 按table_id做HASH分区
  - 每个数据表的记录分散存储

阶段3: 读写分离
  - 主库写入，从库读取
  - PostgreSQL流复制(Streaming Replication)

阶段4: Citus分布式
  - 数据量超过5000万行时考虑
  - 自动分片到多台服务器

阶段5: OLAP引擎
  - 引入ClickHouse/DuckDB做分析
  - 通过CDC同步数据
```

### 性能对比

| 数据量 | 方案 | 预期查询性能 |
|--------|------|-------------|
| < 100万 | 单机PG + 索引 | < 100ms |
| 100万-1000万 | 分区 + 缓存 | < 200ms |
| 1000万-1亿 | Citus / 读写分离 | < 500ms |
| > 1亿 | Citus + OLAP引擎 | 分析: 秒级 |

## 参考链接
- [PG分区和分片 - Citus](https://www.citusdata.com/blog/2023/08/04/understanding-partitioning-and-sharding-in-postgres-and-citus/)
- [PG水平扩展3种方案 - Tinybird](https://www.tinybird.co/blog/postgresql-horizontal-scaling)
- [PG分片实践 - DZone](https://dzone.com/articles/implementing-sharding-in-postgresql-a-comprehensiv)
- [PG分区vs分片指南](https://learnomate.org/partitioning-vs-sharding-postgresql-online-guide/)
- [多租户Docker架构](https://oneuptime.com/blog/post/2026-02-08-how-to-design-a-multi-tenant-docker-architecture/view)
- [K8s多租户SaaS - Red Hat](https://developers.redhat.com/articles/2022/08/12/implement-multitenant-saas-kubernetes)
- [K8s多租户官方文档](https://kubernetes.io/docs/concepts/security/multi-tenancy/)
