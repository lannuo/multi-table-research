# Loro + PostgreSQL + S3 架构方案调研

> 调研日期: 2026-04
> 背景: 基于前一轮 CRDT+SQLite 深度调研的自检发现（AppFlowy 云端实际使用 PostgreSQL、Loro 在表格场景性能大幅领先 Yrs），评估 Loro + PostgreSQL + S3 作为新架构方案的可行性

---

## 一、方案动机

### 1.1 前轮调研发现的问题

| 问题 | 说明 |
|------|------|
| 服务端 SQLite 缺生产验证 | AppFlowy 客户端用 SQLite，但**服务端用 PostgreSQL + S3**。未找到以 SQLite 做服务端主存储的 CRDT 协作产品 |
| Loro 表格性能领先 Yrs | 并发 Map 操作快 **65x**，并发操作快 **12x**，原生 Move 操作，Shallow Snapshot 减少内存 |
| Yrs 需复杂 Move 方案 | 行/列拖拽排序需 Delete+Insert+Testament，复杂且易出错。Loro 原生 MovableList |
| Yrs 无原生版本控制 | 需自建快照轮转。Loro 内建 Git-like DAG 历史和 Shallow Snapshot |

### 1.2 新方案核心思路

```
前端: React + Loro WASM + loro-extended/react
后端: Rust (Axum) + loro crate + sqlx (PostgreSQL)
文件: S3 / MinIO
同步: loro-protocol (传输无关) + WebSocket
离线: IndexedDB (客户端)
```

---

## 二、Loro CRDT 深度评估

### 2.1 Loro Rust API（服务端使用）

Loro 是**纯 Rust 库**，不处理网络/存储/同步协议，由使用者自行管理。核心 API：

```rust
use loro::{LoroDoc, ExportMode};

// 创建文档
let doc = LoroDoc::new();

// 容器操作（多维表格映射）
let map = doc.get_map("table");          // → 表格根节点
let cells = map.get_map("cells");        // → 单元格 YMap
let fields = map.get_list("fields");     // → 字段列表
let rows = map.get_movable_list("rows"); // → 行列表（可移动！）

// 导出/导入
let snapshot = doc.export(ExportMode::Snapshot);       // 全量快照
let updates = doc.export(ExportMode::all_updates());   // 所有操作
doc.import(&bytes);                                     // 导入

// 版本控制
let frontiers = doc.state_frontiers();
let forked = doc.fork_at(&frontiers);                  // 分叉

// Shallow Snapshot（减少历史占用）
let shallow = doc.export(ExportMode::shallow_snapshot_since(version));
```

**容器类型完整列表**：

| 容器 | 用途 | 多维表格映射 |
|------|------|------------|
| `LoroMap` | 键值映射 | 单元格数据、字段元数据、视图配置 |
| `LoroList` | 有序列表 | 字段顺序 |
| `LoroText` | 文本 | 富文本单元格 |
| `MovableList` | 可移动列表 | **行列表（支持拖拽排序）** |
| `Tree` | 树形结构 | 工作区/文件夹层级 |
| `Counter` | 计数器 | 统计字段 |

**关键优势**: `MovableList` 原生支持 move 操作，确保并发移动后每个元素只占一个位置。这在 Yjs/Yrs 中需要复杂的 Delete+Insert+Testament 方案。

### 2.2 Loro vs Yjs/Yrs 性能对比

来源: [Loro 官方基准测试](https://loro.dev/docs/performance)，MacBook Pro M1

#### 对多维表格最关键的指标

| 场景 | Yjs | Loro | 优势 |
|------|-----|------|------|
| **并发 Map set 100K** | 31,598ms | **488ms** | **65x** |
| **并发 插入+删除 100K** | 27,138ms | **2,335ms** | **12x** |
| **大文档解析 (2600万操作)** | 1,270ms | **66ms** | **19x** |
| **真实编辑数据集 100x** | 279,705ms | **233,739ms** | 1.2x |
| **B4 文档大小** | 22.7MB | **21.0MB** | 略小 |

> Map 操作快 65x 对多维表格意义巨大：每次单元格编辑都是一次 Map set 操作。

#### Loro 的劣势

| 维度 | Loro | Yjs |
|------|------|-----|
| Bundle 大小 | 2.9MB (gzipped 894KB) | **84KB** (gzipped 25KB) |
| 单次追加字符 | 164ms | **141ms** |
| 生态成熟度 | v1.0（2025.09） | 2015 年起，久经考验 |
| 前端 JS 生态 | 较小 | 丰富（y-websocket, y-codemirror 等） |
| 生产验证 | 少量 | Yjs: 大量 / Yrs: AppFlowy |

### 2.3 Shallow Snapshot — Loro 独有的内存优化

```
普通快照: 包含完整历史 + 当前状态 → 文档越来越大
Shallow Snapshot: 类似 Git Shallow Clone → 只保留最近 N 层历史
  ├── 当前完整状态 ✓
  ├── 最近 N 层操作历史 ✓
  └── 更早的历史 → 丢弃或归档到冷存储
```

**对大文档的影响**：
- 200K 行表格的完整快照可能 50-100MB
- Shallow Snapshot（depth=1）只含最新状态 + 一层历史，**可降至几 MB**
- Yjs/Yrs 没有此特性，只能做全量快照轮转

### 2.4 Loro 协议（同步）

[loro-protocol](https://github.com/loro-dev/protocol) 是传输无关的 CRDT 同步协议：
- 支持 WebSocket、HTTP、WebRTC 等任意传输层
- 两步握手即可同步两个文档
- 与 Yjs 同步协议类似但更高效

---

## 三、loro-extended 生态（前端集成）

### 3.1 项目概况

[loro-extended](https://github.com/SchoolAI/loro-extended) 由 SchoolAI 开发，是 Loro 的应用层框架：

| 维度 | 说明 |
|------|------|
| 许可证 | MIT |
| 语言 | TypeScript（核心 Loro 仍是 Rust + WASM） |
| 定位 | "Zero-Plumbing" — 写业务逻辑，框架处理同步/持久化/冲突 |
| 示例应用 | 协作 Todo、AI Chat、视频会议、ProseMirror 富文本、WebSocket 同步 |

### 3.2 核心包

#### 存储适配器

| 包 | 用途 | 说明 |
|----|------|------|
| `@loro-extended/adapter-postgres` | **服务端 PostgreSQL 持久化** | Loro 文档存入 PG |
| `@loro-extended/adapter-leveldb` | 服务端 LevelDB 持久化 | 备选方案 |
| `@loro-extended/adapter-indexeddb` | 客户端离线存储 | 浏览器本地持久化 |

#### 网络适配器

| 包 | 用途 |
|----|------|
| `@loro-extended/adapter-websocket` | WebSocket 实时同步 |
| `@loro-extended/adapter-sse` | SSE 实时同步 |
| `@loro-extended/adapter-http-polling` | HTTP 长轮询 |
| `@loro-extended/adapter-webrtc` | P2P 同步 |

#### React 集成

| 包 | 用途 |
|----|------|
| `@loro-extended/react` | `useDocument`, `useValue`, `usePresence` 等 Hooks |
| `@loro-extended/change` | Schema-First 类型安全的文档操作 |
| `@loro-extended/repo` | 文档生命周期管理和同步引擎 |

### 3.3 Schema-First 类型安全

```typescript
import { createTypedDoc, Shape, change } from "@loro-extended/change";

// 定义表格文档结构
const tableSchema = Shape.doc({
  meta: Shape.struct({
    id: Shape.plain.string(),
    name: Shape.plain.string(),
  }),
  fields: Shape.list(
    Shape.struct({
      id: Shape.plain.string(),
      name: Shape.plain.string(),
      type: Shape.plain.string(),      // text, number, date, select...
      options: Shape.plain.string(),    // JSON 序列化的配置
    })
  ),
  rows: Shape.list(
    Shape.struct({
      id: Shape.plain.string(),
      order: Shape.plain.string(),      // Fractional Index
    })
  ),
  cells: Shape.map(Shape.plain.string()),  // key = "rowId:fieldId", value = JSON
});

const doc = createTypedDoc(tableSchema);

// 类型安全的操作
change(doc, (draft) => {
  draft.fields.push({ id: "f1", name: "姓名", type: "text", options: "{}" });
  draft.rows.push({ id: "r1", order: "a0" });
  draft.cells.set("r1:f1", "张三");
});
```

### 3.4 React 集成示例

```tsx
import { useDocument, useValue } from "@loro-extended/react";
import { RepoProvider } from "@loro-extended/react";
import { WebSocketNetworkAdapter } from "@loro-extended/adapter-websocket";
import { IndexedDBStorageAdapter } from "@loro-extended/adapter-indexeddb";

// 配置 Provider
const config = {
  adapters: [
    new WebSocketNetworkAdapter({ url: "ws://localhost:3000/sync" }),
    new IndexedDBStorageAdapter(),
  ],
};

function TableApp() {
  const doc = useDocument("table-123", tableSchema);
  const fields = useValue(doc.fields);
  const cells = useValue(doc.cells);

  return (
    <CanvasTable fields={fields} rows={rows} cells={cells} />
  );
}

function Root() {
  return (
    <RepoProvider config={config}>
      <TableApp />
    </RepoProvider>
  );
}
```

### 3.5 服务端（TypeScript 版）

```typescript
import express from "express";
import { Repo } from "@loro-extended/repo";
import { PostgresStorageAdapter } from "@loro-extended/adapter-postgres";

const storage = new PostgresStorageAdapter({
  connectionString: process.env.DATABASE_URL,
});
const network = new WebSocketServerNetworkAdapter();

new Repo({ adapters: [network, storage], identity: { name: "server" } });

app.use("/sync", createWebSocketRouter(network));
```

---

## 四、Rust 后端集成方案

### 4.1 关键问题：loro-extended 是 TS 生态

`loro-extended` 提供的 PG 适配器、WebSocket 适配器、React Hooks 都是 **TypeScript** 实现。对于我们的 **纯 Rust 后端**，需要自建：

| 层 | loro-extended 提供 | 我们需要自建 |
|----|-------------------|------------|
| CRDT 核心 | Loro Rust crate ✅ | 直接使用 `loro` crate |
| PG 持久化 | TS 适配器 ❌ | Rust: sqlx + 自建 schema |
| WebSocket 同步 | TS 适配器 ❌ | Rust: axum + tungstenite + loro-protocol |
| 前端 React | React Hooks ✅ | 直接使用 `@loro-extended/react` |
| 客户端离线 | IndexedDB 适配器 ✅ | 直接使用 |

### 4.2 Rust 后端架构

```
Axum Web Server
├── REST API 路由
│   ├── /api/auth          → 认证（JWT）
│   ├── /api/spaces        → 工作区 CRUD
│   ├── /api/tables        → 表格元数据 CRUD
│   ├── /api/permissions   → 权限管理
│   ├── /api/automations   → 自动化规则
│   └── /api/files         → 文件上传/下载（S3）
│
├── WebSocket 路由
│   └── /ws/sync/:table_id → Loro CRDT 实时同步
│       ├── 加载 LoroDoc（内存或 PG）
│       ├── 接收客户端 updates
│       ├── 广播给同房间其他客户端
│       └── 异步持久化到 PostgreSQL
│
├── 后台任务
│   ├── 定期快照压缩（Shallow Snapshot）
│   ├── 公式引擎重算（Formualizer）
│   ├── FTS 搜索索引更新
│   └── 自动化触发器检查
│
└── 共享状态
    ├── LoroDoc 池（热表缓存在内存）
    ├── PostgreSQL 连接池（sqlx）
    └── S3 客户端（rust-s3）
```

### 4.3 PostgreSQL Schema 设计

```sql
-- ===== 用户与权限 =====
CREATE TABLE users (
    id UUID PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE teams (
    id UUID PRIMARY KEY,
    name TEXT NOT NULL,
    owner_id UUID REFERENCES users(id),
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE spaces (
    id UUID PRIMARY KEY,
    team_id UUID REFERENCES teams(id),
    name TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE permissions (
    id UUID PRIMARY KEY,
    user_id UUID REFERENCES users(id),
    resource_type TEXT NOT NULL,  -- 'space' | 'table'
    resource_id UUID NOT NULL,
    role TEXT NOT NULL,           -- 'owner' | 'admin' | 'editor' | 'viewer'
    created_at TIMESTAMPTZ DEFAULT now()
);

-- ===== 表格元数据 =====
CREATE TABLE tables (
    id UUID PRIMARY KEY,
    space_id UUID REFERENCES spaces(id),
    name TEXT NOT NULL,
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- ===== CRDT 持久化 =====
CREATE TABLE crdt_snapshots (
    table_id UUID NOT NULL REFERENCES tables(id) ON DELETE CASCADE,
    version TEXT NOT NULL,              -- Loro Frontiers/VersionVector
    snapshot BYTEA NOT NULL,            -- Loro 导出的二进制快照
    is_shallow BOOLEAN DEFAULT false,   -- 是否为 Shallow Snapshot
    created_at TIMESTAMPTZ DEFAULT now(),
    PRIMARY KEY (table_id, version)
);
CREATE INDEX idx_snapshots_table_latest ON crdt_snapshots(table_id, created_at DESC);

CREATE TABLE crdt_updates (
    id BIGSERIAL PRIMARY KEY,
    table_id UUID NOT NULL REFERENCES tables(id) ON DELETE CASCADE,
    peer_id TEXT NOT NULL,              -- 客户端标识
    counter BIGINT NOT NULL,            -- 操作序号
    update BYTEA NOT NULL,              -- Loro 导出的增量更新
    created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_updates_table_counter ON crdt_updates(table_id, counter);

-- ===== 自动化规则 =====
CREATE TABLE automations (
    id UUID PRIMARY KEY,
    table_id UUID REFERENCES tables(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    trigger_type TEXT NOT NULL,          -- 'record_created' | 'field_changed' | ...
    trigger_config JSONB NOT NULL,
    action_type TEXT NOT NULL,           -- 'webhook' | 'update_field' | 'send_email' | ...
    action_config JSONB NOT NULL,
    enabled BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- ===== 搜索索引（全文搜索） =====
-- 使用 PostgreSQL tsvector 而非 SQLite FTS5
CREATE TABLE search_index (
    table_id UUID NOT NULL,
    record_id TEXT NOT NULL,
    field_id TEXT NOT NULL,
    content TEXT NOT NULL,
    content_tsv TSVECTOR GENERATED ALWAYS AS (to_tsvector('simple', content)) STORED,
    created_at TIMESTAMPTZ DEFAULT now(),
    PRIMARY KEY (table_id, record_id, field_id)
);
CREATE INDEX idx_search_tsv ON search_index USING GIN(content_tsv);
```

### 4.4 CRDT 数据流

```
写入流:
用户编辑 → Loro 客户端 (WASM) → WebSocket → Axum 服务端
    → LoroDoc.apply_update(bytes)       # 应用到内存中的 Loro 文档
    → 广播给同房间其他客户端              # WebSocket broadcast
    → 异步 INSERT INTO crdt_updates     # PostgreSQL 追加操作日志
    → 触发公式重算 / 搜索索引更新         # 后台任务

读取流:
客户端连接 → 加载最新 snapshot → 重放后续 updates → 完整 LoroDoc 状态
    → 客户端通过 Loro Protocol 增量同步

快照压缩（定期）:
    → LoroDoc.export(ShallowSnapshot)   # 只保留最近历史
    → 替换 crdt_snapshots 表中的旧快照
    → DELETE 旧 crdt_updates            # 清理已压缩的操作日志
```

### 4.5 热表缓存策略

```
内存:
├── LRU 缓存最近活跃的 LoroDoc（如最近 1 小时内被编辑的表）
├── 最大缓存数限制（如 100 个表）
├── 淘汰时导出快照到 PostgreSQL
└── Shallow Snapshot 减少内存占用

加载:
├── 先查内存缓存
├── 未命中 → 从 PG 加载最新 snapshot + 重放 updates
├── 加载后放入缓存
└── 大表加载时间: Loro 66ms 解析 2600 万操作
```

---

## 五、S3 文件存储方案

### 5.1 适用场景

| 场景 | 存储位置 |
|------|---------|
| 用户头像 | S3 |
| 附件文件（图片、PDF、Excel） | S3 |
| CRDT 冷归档快照 | S3（降低 PG 存储成本） |
| 导出文件（CSV、Excel） | S3 临时存储 |

### 5.2 Rust S3 集成

```rust
use rust_s3::Bucket;

// MinIO（私有化）或 AWS S3
let bucket = Bucket::new("multi-table-files", region, credentials)?;

// 上传
bucket.put_object(format!("attachments/{}", file_id), &data).await?;

// 生成预签名 URL（带过期时间）
let url = bucket.presign_get(format!("attachments/{}", file_id), 3600, None)?;
```

### 5.3 部署选项

| 环境 | S3 方案 |
|------|--------|
| 私有化 | MinIO（Docker 部署，S3 兼容） |
| 云端 | AWS S3 / 阿里云 OSS / 腾讯 COS |
| 开发 | MinIO 本地 Docker |

---

## 六、与前方案（Yrs + SQLite）对比

| 维度 | Yrs + SQLite | Loro + PostgreSQL + S3 |
|------|-------------|----------------------|
| **CRDT 性能** | Map 100K: 31.6s | **Map 100K: 0.5s (65x)** |
| **行拖拽排序** | Delete+Insert+Testament（复杂） | **原生 MovableList** |
| **GC/历史管理** | 自建快照轮转 | **Shallow Snapshot 内建** |
| **版本控制** | 需自建 | **Git-like DAG 内建** |
| **服务端存储** | SQLite（缺服务端生产验证） | **PostgreSQL（AppFlowy 验证）** |
| **全文搜索** | SQLite FTS5（中文需额外处理） | **PG tsvector + pg_jieba** |
| **并发写入** | SQLite 单写入者（~3300/s） | **PG 多写入者（无上限）** |
| **横向扩展** | SQLite 无法多实例共享 | **PG 主从/Citus 分片** |
| **可观测性** | 需自建监控 | **pg_stat_statements 等成熟工具** |
| **备份** | Litestream | **pg_dump / WAL 归档** |
| **部署复杂度** | 单二进制 + 文件 | Docker: Axum + PG + MinIO |
| **前端生态** | Yjs 成熟但需手动集成 | **loro-extended 提供 React Hooks** |
| **Bundle 大小** | 84KB | 2.9MB（需评估） |
| **CRDT 库成熟度** | Yrs 被 AppFlowy 验证 | Loro v1.0（较新） |
| **运维成本** | 极低（单文件） | 中等（需维护 PG） |

---

## 七、风险评估

### 7.1 采用 Loro 的风险

| 风险 | 影响 | 缓解 |
|------|------|------|
| Loro v1.0 较新，可能遇到 bug | 开发中断 | Loro 团队活跃，MIT 许可可自行修复 |
| 前端 Bundle 2.9MB | 首次加载慢 | 按需加载、CDN、HTTP/2 Push |
| Rust 后端需自建 PG 持久化层 | 开发工作量 | 参考 loro-extended TS 实现移植 |
| 社区/文档不如 Yjs | 学习成本 | Loro 官方文档质量高，有示例 |
| 未来 Loro 方向变更 | 长期风险 | MIT 许可，可 Fork |

### 7.2 采用 PostgreSQL 的风险

| 风险 | 影响 | 缓解 |
|------|------|------|
| 运维复杂度高于 SQLite | 需要数据库运维 | Docker 简化部署，后期可托管 |
| 私有化客户需安装 PG | 部署门槛 | 提供 Docker Compose 一键部署 |
| 开发环境搭建稍复杂 | 开发体验 | docker-compose.dev.yml |

### 7.3 风险总评

Loro + PostgreSQL 的**技术风险可控**：
- Loro 核心算法经过严格学术验证，v1.0 已稳定
- PostgreSQL 是最成熟的开源数据库之一
- loro-extended 证明了 Loro + PG 的可行性
- Rust 后端自建持久化层的工作量不大（参考 loro-extended 的 TS 实现）

---

## 八、建议的架构总览

```
┌──────────── 前端 ──────────────────────────────┐
│  React + Next.js                               │
│  Canvas 表格渲染 / 虚拟滚动                      │
│  Loro WASM (loro-crdt) + loro-extended/react   │
│  Formualizer 公式引擎 (WASM)                    │
│  IndexedDB 离线存储                              │
├──────────── 后端 ──────────────────────────────┤
│  Rust (Axum) — 统一后端                         │
│  ├── REST API（认证/权限/元数据/文件）            │
│  ├── WebSocket（Loro CRDT 同步）                │
│  │   └── loro crate + loro-protocol            │
│  ├── Formualizer（原生 Rust 公式引擎）           │
│  ├── 自动化工作流引擎                            │
│  └── 后台任务（快照压缩/搜索索引/公式重算）        │
├──────────── 数据层 ─────────────────────────────┤
│  PostgreSQL                                     │
│  ├── 关系表：users/spaces/permissions/automations│
│  ├── CRDT 快照/操作日志 (BYTEA)                  │
│  ├── 全文搜索 (tsvector + pg_jieba)             │
│  └── LoroDoc 热表缓存（进程内存 + LRU）          │
├──────────── 文件存储 ───────────────────────────┤
│  S3 / MinIO                                    │
│  ├── 附件文件                                   │
│  ├── 用户头像                                   │
│  └── CRDT 冷归档快照                             │
├──────────── 可选扩展 ───────────────────────────┤
│  Redis（多实例广播/会话缓存）                     │
│  Meilisearch（高级搜索）                         │
│  ClickHouse（OLAP 分析）                        │
└────────────────────────────────────────────────┘
```

---

## 九、与现有决策的差异汇总

| 维度 | 现有决策 | 新方向 | 变更原因 |
|------|---------|--------|---------|
| CRDT 库 | Yjs + Yrs | **Loro** | Map 操作 65x 快，原生 Move，Shallow Snapshot |
| 服务端数据库 | SQLite | **PostgreSQL** | 服务端生产验证，横向扩展，可观测性 |
| 文件存储 | 无 | **S3/MinIO** | 附件存储标准方案 |
| 搜索 | SQLite FTS5 | **PG tsvector + pg_jieba** | 更好的中文支持，成熟生态 |
| 权限实现 | SQLite 无 RLS | **PG RLS + 应用层 RBAC** | PG 原生行级安全 |
| 部署 | 单二进制 | **Docker Compose (Axum + PG + MinIO)** | 更标准但稍复杂 |
| 前端 CRDT 集成 | 手动 Yjs 绑定 | **loro-extended/react** | 开箱即用的 React Hooks |

---

## 参考链接

### Loro 核心
- [Loro v1.0 Blog](https://loro.dev/blog/v1.0) — v1.0 发布：Shallow Snapshot / Eg-walker / Movable List
- [Loro Performance](https://loro.dev/docs/performance) — vs Yjs/Automerge 基准测试
- [Loro Rust API (docs.rs)](https://docs.rs/loro/latest/loro/struct.LoroDoc.html) — Rust 服务端 API
- [Loro Persistence](https://loro.dev/docs/tutorial/persistence) — 持久化最佳实践
- [Loro Sync Protocol](https://loro.dev/docs/tutorial/sync) — 同步协议
- [loro-dev/protocol (GitHub)](https://github.com/loro-dev/protocol) — 同步协议实现
- [Loro GitHub](https://github.com/loro-dev/loro) — 源码仓库

### loro-extended（前端生态）
- [loro-extended (GitHub)](https://github.com/SchoolAI/loro-extended) — 应用层框架
- PostgreSQL 适配器: `@loro-extended/adapter-postgres`
- React Hooks: `@loro-extended/react`
- WebSocket 适配器: `@loro-extended/adapter-websocket`
- Schema-First 类型安全: `@loro-extended/change`

### PostgreSQL
- [AppFlowy-Cloud](https://github.com/AppFlowy-IO/AppFlowy-Cloud) — AppFlowy 服务端使用 PG 的参考
- [pg_jieba](https://github.com/jaiminpan/pg_jieba) — PostgreSQL 中文分词扩展
- [PostgreSQL RLS](https://www.postgresql.org/docs/current/ddl-rowsecurity.html) — 行级安全策略

### S3 / MinIO
- [rust-s3 (crates.io)](https://crates.io/crates/rust-s3) — Rust S3 客户端
- [MinIO](https://min.io/) — S3 兼容的私有化对象存储

### 前轮调研
- [CRDT + SQLite 深度调研](./crdt-sqlite-deep-research.md) — 本文档的基础
- [CRDT vs OT 深度研究](./crdt-vs-ot-deep-research.md) — Yjs/Yrs 详细研究
- [竞品深度分析](../open-source-projects/competitive-deep-analysis.md) — Notion/飞书/APITable 对比
- [Rust 公式引擎调研](./rust-formula-engine-research.md) — Formualizer 详细分析
