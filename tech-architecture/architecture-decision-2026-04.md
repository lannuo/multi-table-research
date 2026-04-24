# 架构决策记录 — 2026-04 重大变更

> 本文档记录基于竞品深度分析后的架构决策变更过程、分析依据和最终结论。

---

## 决策一：后端从 NestJS+Rust 改为纯 Rust (Axum)

### 原方案
- NestJS (TypeScript) 处理业务 API
- Rust (Axum + Yrs) 处理 CRDT 协作服务
- 两套后端服务，两种语言

### 变更原因
1. **已引入 Rust**：协作服务(Yrs)和公式引擎(Formualizer)都是 Rust，维护 TS+Rust 双栈成本高
2. **消除互操作开销**：NestJS 和 Rust 协作服务之间的通信（HTTP/gRPC）带来延迟和复杂度
3. **统一部署**：单二进制 vs 两个服务的 Docker Compose
4. **Formualizer 直调**：后端可直接调用 Rust 原生公式引擎，无需 WASM 中间层

### 风险与应对
| 风险 | 应对 |
|------|------|
| Rust CRUD 开发效率低于 TS | Axum + sqlx + serde 生态已较成熟；业务逻辑不复杂 |
| 编译时间长影响迭代 | 增量编译 + cargo check；CRUD 部分变更通常很小 |
| 团队需 Rust 能力 | 前端 TS + 后端 Rust 分工，或逐步学习 |
| Axum 中间件生态不如 NestJS | 手动组装（tower 中间件），但更透明可控 |

---

## 决策二：数据存储从 PostgreSQL+JSONB 改为 CRDT 原生+SQLite

### 原方案
- PostgreSQL 存储所有数据
- `records.data JSONB` 存储动态字段值
- JSONB 查询实现筛选/排序/聚合

### 变更原因

#### 1. JSONB 在 Rust 中不友好
```sql
-- JSONB 查询需要动态拼接 SQL
SELECT * FROM records WHERE (data->>'fld123')::numeric > 100;
```
在 Rust/SQLx 中需要手写 SQL 拼接，类型不安全，开发体验差。

#### 2. CRDT 已经是数据的 source of truth
选了 Yjs/Yrs 做协作后，数据在 CRDT 文档中已有完整状态。再用 JSONB 存一份是**双重存储**，需要保证两者同步。

#### 3. 飞书验证了"内存视图引擎"路线
飞书多维表格的"内存表格视图引擎"在内存中做所有计算，PostgreSQL 只是持久层。

#### 4. 竞品参考
- **AppFlowy**: Yrs + **SQLite**
- **AFFiNE**: Yjs + **SQLite**
- 所有使用 CRDT 的产品都没有用 JSONB 存记录数据

### 被否决的中间方案：纯 RocksDB

分析后发现三个致命缺陷：

| 问题 | 说明 |
|------|------|
| **关系型数据无处安放** | 用户/团队/权限/自动化/Webhook 等是关系型数据，KV 存储不适合 |
| **CRDT 文档内存膨胀** | Yjs 文档含操作历史，10万行×50列预估 150-500MB，多表并发压力大 |
| **单进程锁死** | RocksDB 嵌入式存储无法多实例共享，横向扩展需自建复制层 |

### 最终方案：SQLite + CRDT 原生

```
SQLite（嵌入式，单文件）
├── 关系表：users, teams, spaces, permissions, automations, webhooks...
├── CRDT 表：snapshots(BLOB), operations(BLOB)
└── FTS5：全文搜索
```

**SQLite 的优势**：
- 嵌入式零运维——单文件，不需要数据库服务器进程
- 既有 SQL 又能存 BLOB——关系型数据用表，CRDT 数据用 BLOB
- AppFlowy/AFFiNE 生产验证
- FTS5 内置全文搜索
- WAL 模式支持并发读写
- 备份简单（复制文件）
- 后续可迁移到 PostgreSQL（SQL 兼容）

### 数据流设计

```
写入：用户编辑 → Yrs Doc.apply_update(update)
     → 持久化 update 到 SQLite crdt_operations 表
     → 定期压缩为 snapshot 存入 crdt_snapshots 表

读取：加载最新 snapshot → 重放后续 operations → 完整 DocState
     → 遍历 DocState 做筛选/排序/聚合（Rust 内存计算）

搜索：CRDT 状态变更 → 提取文本 → SQLite FTS5 索引

元数据：用户/权限/自动化等 → 标准 SQLite 关系表 + SQL 查询
```

### SQLite 预估表结构

```sql
-- ===== 元数据 =====
CREATE TABLE users (id TEXT PRIMARY KEY, name TEXT, email TEXT, ...);
CREATE TABLE teams (id TEXT PRIMARY KEY, name TEXT, ...);
CREATE TABLE spaces (id TEXT PRIMARY KEY, team_id TEXT, name TEXT, ...);
CREATE TABLE tables (id TEXT PRIMARY KEY, space_id TEXT, name TEXT, ...);
CREATE TABLE permissions (...);

-- ===== CRDT 持久化 =====
CREATE TABLE crdt_snapshots (
    table_id TEXT NOT NULL,
    revision INTEGER NOT NULL,
    snapshot BLOB NOT NULL,        -- Yrs 编码的二进制快照
    created_at TEXT DEFAULT (datetime('now')),
    PRIMARY KEY (table_id, revision)
);

CREATE TABLE crdt_operations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    table_id TEXT NOT NULL,
    revision INTEGER NOT NULL,
    operation BLOB NOT NULL,       -- Yrs 编码的操作更新
    created_by TEXT,
    created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX idx_ops_table_rev ON crdt_operations(table_id, revision);

-- ===== 搜索 =====
CREATE VIRTUAL TABLE search_index USING FTS5(
    table_id, record_id, field_id, content,
    content='records_content'
);
```

### 扩展路径

| 数据量 | 方案 |
|--------|------|
| < 100 万行 | SQLite 单文件，进程内存热表 |
| 100 万 - 1000 万 | SQLite + 内存预聚合缓存 + 分页加载优化 |
| > 1000 万 | 迁移 CRDT 持久化到 PostgreSQL，SQL 兼容平滑迁移 |

---

## 决策三：CRDT 从 Yrs 改为 Loro，存储从 SQLite 改为 PostgreSQL + S3

> 2026-04-24 更新，基于第六轮深度技术调研

### 变更原因

#### 1. Loro 在多维表格场景性能大幅领先

| 关键指标 | Yjs/Yrs | Loro | 优势 |
|---------|---------|------|------|
| 并发 Map set 100K（= 单元格编辑） | 31,598ms | **488ms** | **65x** |
| 并发 插入+删除 100K | 27,138ms | **2,335ms** | **12x** |
| 大文档解析 2600万操作 | 1,270ms | **66ms** | **19x** |

#### 2. Loro 原生支持多维表格核心操作

| 操作 | Yjs/Yrs 方案 | Loro 方案 |
|------|------------|----------|
| 行/列拖拽排序 | Delete+Insert+Testament（复杂，易出错） | **原生 MovableList** |
| 历史压缩 | 自建快照轮转 | **内建 Shallow Snapshot** |
| 版本控制 | 需自建 | **内建 Git-like DAG** |
| 内存优化 | 全量文档常驻内存 | **Shallow Snapshot 丢弃旧历史** |

#### 3. 服务端 SQLite 缺少生产验证

- AppFlowy 客户端用 SQLite，但**服务端用 PostgreSQL + S3**
- 未找到以 SQLite 做服务端主存储的 CRDT 协作产品
- PostgreSQL 在服务端场景成熟度远高于 SQLite

#### 4. loro-extended 生态降低前端开发成本

- `@loro-extended/react` 提供 `useDocument`, `useValue`, `usePresence` 等 React Hooks
- `@loro-extended/adapter-postgres` 已验证 Loro + PostgreSQL 可行性
- `@loro-extended/adapter-indexeddb` 提供客户端离线存储
- Schema-First 类型安全的文档操作

### 变更内容

| 维度 | 原方案（决策二） | 新方案（决策三） |
|------|----------------|----------------|
| CRDT 库 | Yjs + Yrs | **Loro** |
| 服务端数据库 | SQLite | **PostgreSQL** |
| 文件存储 | 无 | **S3 / MinIO** |
| 搜索 | SQLite FTS5 | **PG tsvector + pg_jieba** |
| 权限 | 应用层 RBAC | **PG RLS + 应用层 RBAC** |
| 前端 CRDT | yjs + y-websocket | **loro-crdt (WASM) + loro-extended/react** |
| 部署 | 单二进制 + SQLite 文件 | **Docker Compose (Axum + PG + MinIO)** |
| 离线存储 | 无 | **IndexedDB（loro-extended 已提供）** |

### 风险与应对

| 风险 | 影响 | 应对 |
|------|------|------|
| Loro v1.0 较新 | 可能遇到 bug | MIT 许可可自行修复；团队活跃 |
| 前端 Bundle 2.9MB | 首次加载慢 | 按需加载、CDN、HTTP/2 Push |
| Rust 后端需自建 PG 持久化 | 开发工作量 | 参考 loro-extended TS 实现移植 |
| PG 运维复杂度高于 SQLite | 部署门槛 | Docker Compose 一键部署 |
| loro-extended 是 TS 生态 | 后端无法直接用 | 前端用 loro-extended，后端用 loro crate + sqlx |

### 保留不变的决策

以下决策不受本次变更影响：

- 后端纯 Rust (Axum) ✅
- 公式引擎 Formualizer ✅
- 前端 React + Next.js + Canvas ✅
- UI 组件 Ant Design ✅
- 自动化工作流 Trigger→Action ✅
- 测试 Vitest + Playwright ✅

---

## 变更汇总（完整历史）

| 维度 | 初始方案 | 决策二 (SQLite) | 决策三 (Loro+PG) |
|------|---------|----------------|-----------------|
| 后端语言 | TS (NestJS) + Rust | 纯 Rust (Axum) | **纯 Rust (Axum)** |
| CRDT 库 | OT (参考 APITable) | Yjs + Yrs | **Loro** |
| 服务端数据库 | PostgreSQL + JSONB | SQLite | **PostgreSQL** |
| 文件存储 | MinIO | 无 | **S3 / MinIO** |
| 搜索 | PG 全文 → Meilisearch | SQLite FTS5 | **PG tsvector + pg_jieba** |
| 前端协作 | OT 客户端 | Yjs 客户端 | **loro-crdt + loro-extended/react** |
| 部署 | Docker (3+ 容器) | 单二进制 | **Docker (Axum + PG + MinIO)** |

---

## 参考依据

- 竞品深度分析：`open-source-projects/competitive-deep-analysis.md`
- Rust 生态调研：`tech-architecture/rust-ecosystem-research.md`
- CRDT vs OT 深度研究：`tech-architecture/crdt-vs-ot-deep-research.md`
- CRDT + SQLite 深度调研：`tech-architecture/crdt-sqlite-deep-research.md`
- **Loro + PostgreSQL 架构调研**：`tech-architecture/loro-postgresql-architecture-research.md`
- 数据模型设计：`data-storage/data-model-design.md`
- AppFlowy 架构：Yrs + SQLite 生产验证（客户端），**PostgreSQL + S3（服务端）**
- AFFiNE 架构：Yjs + SQLite 生产验证
- **loro-extended**：Loro 应用层框架（PG 适配器 / React Hooks / WebSocket 同步）
