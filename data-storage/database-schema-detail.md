# 数据库 Schema 完整性与迁移策略深度研究

## 概述
本文档补充多维表格产品的数据库 Schema 设计，涵盖用户认证表、PostgreSQL 分区策略、乐观锁、迁移策略、JSONB 索引生命周期、APITable Schema 对比和关联字段引用完整性。基于已确定的技术栈（PostgreSQL + JSONB + TypeORM）。

---

## 一、用户与认证表设计

### 1.1 三层模型

SaaS 多租户系统用户体系采用 **User + Space + Membership** 三层模型。

### 1.2 推荐 DDL

```sql
-- 用户表
CREATE TABLE users (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email           VARCHAR(255) NOT NULL UNIQUE,
    password_hash   VARCHAR(255),          -- 本地密码（可选，SSO可空）
    name            VARCHAR(255) NOT NULL,
    avatar_url      TEXT,
    status          SMALLINT DEFAULT 1,    -- 1=活跃, 0=禁用
    last_login_at   TIMESTAMPTZ,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- 第三方登录
CREATE TABLE user_oauth (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(id),
    provider        VARCHAR(50) NOT NULL,   -- google, github, feishu, wechat
    provider_id     VARCHAR(255) NOT NULL,
    access_token    TEXT,
    refresh_token   TEXT,
    expires_at      TIMESTAMPTZ,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(provider, provider_id)
);

-- 组织/空间（租户）
CREATE TABLE spaces (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name            VARCHAR(255) NOT NULL,
    owner_id        UUID NOT NULL REFERENCES users(id),
    plan            VARCHAR(50) DEFAULT 'free',
    settings        JSONB DEFAULT '{}',
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- 空间成员
CREATE TABLE space_members (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    space_id        UUID NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role            VARCHAR(50) NOT NULL DEFAULT 'member',
    joined_at       TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(space_id, user_id)
);

CREATE INDEX idx_spaces_owner ON spaces(owner_id);
CREATE INDEX idx_space_members_user ON space_members(user_id);
CREATE INDEX idx_space_members_space ON space_members(space_id);
```

### 1.3 TypeORM Entity 要点

```typescript
@Entity()
@Unique(['email'])
export class User {
  @PrimaryGeneratedUUID()
  id: string;

  @Column({ select: false })
  passwordHash: string;

  @OneToMany(() => SpaceMember, (m) => m.user)
  memberships: SpaceMember[];
}
```

---

## 二、PostgreSQL 分区策略

### 2.1 三种多租户隔离方式

| 方式 | 适用规模 | 优点 | 缺点 |
|------|----------|------|------|
| 独立数据库 | 10 个租户 | 最强隔离 | 管理开销巨大 |
| Schema 隔离 | 100 个租户 | 良好隔离 | 迁移需遍历所有 Schema |
| 共享表 + tenant_id | 百万级租户 | 最易扩展 | 隔离性弱，需 RLS |

**本项目建议**：初期采用共享表方案，用 `space_id` 做租户标识。后期数据量大了再按需分区。

### 2.2 Hash 分区示例

```sql
CREATE TABLE records (
    id          UUID NOT NULL,
    space_id    UUID NOT NULL,
    table_id    UUID NOT NULL,
    data        JSONB NOT NULL,
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    updated_at  TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (id, space_id)
) PARTITION BY HASH (space_id);

-- 创建 8 个分区
CREATE TABLE records_p0 PARTITION OF records FOR VALUES WITH (MODULUS 8, REMAINDER 0);
CREATE TABLE records_p1 PARTITION OF records FOR VALUES WITH (MODULUS 8, REMAINDER 1);
-- ... 至 p7
```

### 2.3 分区裁剪（Partition Pruning）

`enable_partition_pruning = on`（默认开启）

查询带 `WHERE space_id = 'xxx'` 时，自动跳过无关分区。

### 2.4 重要限制

- 分区表的唯一约束必须包含分区键列
- 主键必须包含分区键（如 `PRIMARY KEY (id, space_id)`）
- 不要过度分区

---

## 三、乐观锁（Optimistic Locking）

### 3.1 版本列实现

```sql
ALTER TABLE records ADD COLUMN version INT DEFAULT 1;

UPDATE records
SET data = '{"fld001": "new value"}',
    version = version + 1,
    updated_at = NOW()
WHERE id = 'rec123' AND version = 5;
-- 返回 0 行 = 被其他人修改了，需重试
```

### 3.2 带重试逻辑的函数

```sql
CREATE OR REPLACE FUNCTION update_record_optimistic(
    p_id UUID,
    p_data JSONB,
    p_expected_version INT,
    p_max_retries INT DEFAULT 3
) RETURNS BOOLEAN AS $$
DECLARE
    v_updated INT;
    v_retry INT := 0;
BEGIN
    LOOP
        UPDATE records
        SET data = p_data,
            version = version + 1,
            updated_at = NOW()
        WHERE id = p_id AND version = p_expected_version;

        GET DIAGNOSTICS v_updated = ROW_COUNT;
        IF v_updated > 0 THEN RETURN TRUE; END IF;

        v_retry := v_retry + 1;
        IF v_retry >= p_max_retries THEN RETURN FALSE; END IF;
        PERFORM pg_sleep(0.01 * v_retry);
    END LOOP;
END;
$$ LANGUAGE plpgsql;
```

### 3.3 JSONB 细粒度更新

```sql
-- 只更新一个字段（减少锁争用）
UPDATE records
SET data = jsonb_set(data, '{fld001}', '"new value"'),
    version = version + 1
WHERE id = 'rec123' AND version = 5;
```

### 3.4 与 OT 的配合

- OT 服务端提交 changeset 时同时检查 version
- 如果 version 不匹配，重新获取最新 snapshot 做 transform 后再提交

---

## 四、数据库迁移策略

### 4.1 TypeORM 迁移

| 特性 | TypeORM | Prisma |
|------|---------|--------|
| 迁移方式 | 手写 SQL 或自动生成 | Schema 文件驱动 |
| 多 Schema 支持 | 原生支持 | 需要 MultiSchema 插件 |
| NestJS 集成 | 官方推荐 | 需额外配置 |
| 灵活性 | SQL 完全可控 | 生成的 SQL 不可自定义 |

已选 TypeORM，其多租户 Schema 切换能力更灵活。

### 4.2 零停机迁移核心原则

**1. 始终设置 lock_timeout**
```sql
SET lock_timeout = '5s';
ALTER TABLE records ADD COLUMN status TEXT DEFAULT 'active';
RESET lock_timeout;
```

**2. 展开-收缩模式（Expand-Contract）**
```
部署1: 添加新列（不改旧代码） → 展开
部署2: 代码切换到新列 → 过渡
部署3: 删除旧列 → 收缩
```

**3. 批量回填**
```sql
DO $$
DECLARE rows_updated INT;
BEGIN
    LOOP
        UPDATE records SET status = 'active'
        WHERE id IN (
            SELECT id FROM records WHERE status IS NULL LIMIT 10000
        );
        GET DIAGNOSTICS rows_updated = ROW_COUNT;
        EXIT WHEN rows_updated = 0;
        PERFORM pg_sleep(0.5);
    END LOOP;
END $$;
```

**4. 安全添加约束**
```sql
-- NOT NULL: 两步法
ALTER TABLE users ADD CONSTRAINT chk_email_nn CHECK (email IS NOT NULL) NOT VALID;
ALTER TABLE users VALIDATE CONSTRAINT chk_email_nn;

-- 外键: 先 NOT VALID 再验证
ALTER TABLE records ADD CONSTRAINT fk_table
    FOREIGN KEY (table_id) REFERENCES tables(id) NOT VALID;
ALTER TABLE records VALIDATE CONSTRAINT fk_table;

-- 唯一约束: 先建索引再关联
CREATE UNIQUE INDEX CONCURRENTLY idx_users_email ON users(email);
ALTER TABLE users ADD CONSTRAINT uniq_email UNIQUE USING INDEX idx_users_email;
```

**5. 一个事务一条 DDL**

### 4.3 部署顺序规则

| 变更类型 | 部署顺序 |
|---------|---------|
| 添加列 | 先迁移，后部署代码 |
| 删除列 | 先部署代码，后迁移 |
| 重命名列 | 展开-收缩三步 |
| 添加 NOT NULL | 先代码确保无 NULL，后加约束 |
| 添加索引 | 随时，用 CONCURRENTLY |

---

## 五、JSONB 索引生命周期管理

### 5.1 索引创建策略

**通用 GIN 索引**
```sql
CREATE INDEX CONCURRENTLY idx_records_data_gin
ON records USING GIN (data);
-- 支持 @> , ? , ?| , ?& 运算符
```

**表达式索引（精确查询模式）**
```sql
CREATE INDEX CONCURRENTLY idx_records_fld001_numeric
ON records (((data->>'fld001')::numeric));
-- 查询必须精确匹配表达式
```

**部分索引**
```sql
CREATE INDEX CONCURRENTLY idx_records_pending
ON records (created_at)
WHERE (data->>'status') = 'pending';
```

### 5.2 CREATE INDEX CONCURRENTLY 要点

- **不阻塞读写**
- **不能在事务内使用**
- **可能失败**：失败后索引标记为 INVALID，需 DROP 后重试
- **耗时更长**：需要两次全表扫描

### 5.3 索引维护

```sql
-- 检查索引膨胀
SELECT schemaname, tablename, indexname,
       pg_size_pretty(pg_relation_size(indexrelid))
FROM pg_stat_user_indexes
WHERE schemaname = 'public'
ORDER BY pg_relation_size(indexrelid) DESC;

-- 重建索引（不阻塞）
REINDEX INDEX CONCURRENTLY idx_records_data_gin;

-- 查看未使用的索引
SELECT schemaname, tablename, indexname, idx_scan
FROM pg_stat_user_indexes
WHERE idx_scan = 0
ORDER BY pg_relation_size(indexrelid) DESC;
```

### 5.4 动态索引创建

当用户为某个字段启用筛选/排序时按需创建：

```sql
DO $$
BEGIN
    EXECUTE format(
        'CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_records_%s
         ON records (((data->>''%s'')::text))',
        p_field_id, p_field_id
    );
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'Index creation deferred: %', SQLERRM;
END $$;
```

### 5.5 GIN 索引适用场景

| 查询类型 | 能用 GIN | 需要表达式索引 |
|---------|---------|--------------|
| `data @> '{"status": "active"}'` | 是 | 否 |
| `data ? 'status'` | 是 | 否 |
| `data->>'email' = 'test@example.com'` | 否 | 是 |
| `(data->>'age')::int > 30` | 否 | 是 |
| `data->>'name' ILIKE 'test%'` | 否 | 是 |

---

## 六、APITable 数据库 Schema 对比

### 6.1 APITable 核心架构

APITable 以 **Snapshot + Changeset + Operation** 为核心。

```
空间层:     Space（租户/组织）
    ├── 节点层:    Node（文件/文件夹树形结构）
    │       ├── Datasheet（数据表）
    │       ├── Dashboard（仪表盘）
    │       ├── Form（表单）
    │       └── Mirror（视图镜像）
    ├── 用户层:    SpaceMember / Role
    └── 自动化层:  Automation / Robot / Action / Trigger
```

### 6.2 Snapshot 模型

APITable 将整个表的状态存储为一个大 JSONB Snapshot：

```json
{
    "fieldMap": { "fld001": {...}, "fld002": {...} },
    "views": [{ "id": "viw001", "columns": [...], "rows": [...], "filter": {}, "sort": {} }],
    "recordMap": { "rec001": { "fields": { "fld001": "Hello", "fld002": 42 } } }
}
```

### 6.3 与我们方案的对比

| 方面 | APITable | 我们的方案 |
|------|---------|-----------|
| 元数据存储 | 整体 Snapshot JSONB | 分表：tables + fields + views |
| 记录存储 | Snapshot.recordMap | 独立 records 表 |
| 版本控制 | Changeset 列表 | changesets 表 |
| 查询 | 先获取 Snapshot 再过滤 | 直接 SQL 查 records 表 |
| 优势 | 简单，OT 天然适配 | 查询灵活，大数据量性能好 |

**结论**：分表方案正确。APITable 的 Snapshot 模式在数据量小时简单，但单表 10 万行以上 Snapshot 非常大。

---

## 七、关联字段引用完整性

### 7.1 Link 关系表设计

```sql
CREATE TABLE record_links (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_table_id UUID NOT NULL,
    source_field_id UUID NOT NULL,
    source_record_id UUID NOT NULL,
    target_record_id UUID NOT NULL,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(source_field_id, source_record_id, target_record_id)
);

CREATE INDEX idx_record_links_source ON record_links(source_record_id);
CREATE INDEX idx_record_links_target ON record_links(target_record_id);
CREATE INDEX idx_record_links_field  ON record_links(source_field_id);
```

### 7.2 循环引用检测（递归 SQL）

```sql
CREATE OR REPLACE FUNCTION check_link_cycle(
    p_source_record_id UUID,
    p_target_record_id UUID,
    p_field_id UUID
) RETURNS BOOLEAN AS $$
BEGIN
    IF p_source_record_id = p_target_record_id THEN RETURN FALSE; END IF;

    RETURN NOT EXISTS (
        WITH RECURSIVE link_tree AS (
            SELECT target_record_id AS current_id
            FROM record_links
            WHERE source_record_id = p_target_record_id
              AND source_field_id = p_field_id
            UNION ALL
            SELECT rl.target_record_id
            FROM record_links rl
            JOIN link_tree lt ON rl.source_record_id = lt.current_id
            WHERE rl.source_field_id = p_field_id
        )
        SELECT 1 FROM link_tree WHERE current_id = p_source_record_id
    );
END;
$$ LANGUAGE plpgsql;
```

### 7.3 推荐策略

| 场景 | 策略 |
|------|------|
| 跨表 Link（表A→表B） | 独立 record_links 表 + 应用层验证 |
| 同表自引用（树形） | level 列 + CHECK 约束 |
| 深度循环检测 | 应用层 BFS，限制递归深度（≤10） |
| 双向 Link | 两个方向的记录同时写入 |

---

## 八、Schema 增量补充清单

| 优先级 | 表名 | 用途 |
|--------|------|------|
| P0 | `users` | 用户基本信息 |
| P0 | `user_oauth` | 第三方登录 |
| P0 | `spaces` | 组织/空间（租户） |
| P0 | `space_members` | 空间成员与角色 |
| P1 | `record_links` | 关联记录关系 |
| P1 | `roles` | 角色定义 |
| P1 | `resource_permissions` | 资源级权限 |
| P2 | `audit_logs` | 操作审计 |
| P2 | `api_tokens` | API 令牌 |
| P2 | `attachments` | 文件附件元数据 |
| P2 | `share_links` | 分享链接 |
| P2 | `automations` | 自动化规则 |
| P2 | `automation_runs` | 自动化执行日志 |
| P2 | `webhooks` | Webhook 配置 |

现有 `records` 表需增加：
- `version INT DEFAULT 1` — 乐观锁
- `space_id UUID` — 多租户标识（为未来分区准备）

---

## 参考链接

- [Building Scalable SaaS: Multi-Tenant Architecture with PostgreSQL and TypeORM](https://blogs.pranitpatil.com/building-scalable-saas-multi-tenant-architecture-with-postgresql-and-typeorm-design-and-implementation)
- [Designing Your Postgres Database for Multi-tenancy - Crunchy Data](https://www.crunchydata.com/blog/designing-your-postgres-database-for-multi-tenancy)
- [PostgreSQL 官方文档 - Table Partitioning](https://www.postgresql.org/docs/current/ddl-partitioning.html)
- [Multi-tenant Architectures on PostgreSQL](https://mounick.medium.com/multi-tenant-architectures-on-postgresql-lessons-learned-05292daab442)
- [How to Handle Lock Contention in PostgreSQL - OneUptime](https://oneuptime.com/blog/post/2026-02-02-postgresql-lock-contention/view)
- [PostgreSQL Migration Best Practices for Zero-Downtime](https://dev.to/mickelsamuel/postgresql-migration-best-practices-for-zero-downtime-deployments-1c4)
- [Zero-Downtime Schema Migrations in PostgreSQL](https://medium.com/@antoniodipinto/zero-downtime-schema-migrations-in-postgresql-c138017e7f90)
- [Prisma vs TypeORM - Bytebase](https://www.bytebase.com/blog/prisma-vs-typeorm/)
- [Indexing JSONB in Postgres - Crunchy Data](https://www.crunchydata.com/blog/indexing-jsonb-in-postgres)
- [Understanding Postgres GIN Indexes - pganalyze](https://pganalyze.com/blog/gin-index)
- [PostgreSQL JSONB Performance Guide - SitePoint](https://www.sitepoint.com/postgresql-jsonb-query-performance-indexing/)
- [APITable GitHub Repository](https://github.com/apitable/apitable)
- [How to prevent circular references in PostgreSQL - StackOverflow](https://stackoverflow.com/questions/68161627/how-to-prevent-circular-references-in-a-linked-list-in-postgresql)
- [Designing RBAC Permission System with NestJS](https://dev.to/leapcell/designing-rbac-permission-system-with-nestjs-a-step-by-step-guide-3bhl)
- [Building a Production-Ready Auth System with NestJS](https://itnext.io/building-a-production-ready-auth-system-with-nestjs-part-01-c1fcf13f05dd)
