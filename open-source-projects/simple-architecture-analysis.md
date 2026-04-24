# 竞品简单架构深度分析

> 分析日期: 2026-04-24
> 背景: 当前竞品分析集中在最复杂的三个产品（Notion/飞书/APITable），缺少对"可操作参考架构"的研究。本文分析四个无 CRDT 或简单架构的产品，识别可借鉴的务实设计方案。

---

## 一、核心发现

这四个产品有一个共同点：**都不使用 CRDT，但都实现了多人协作**。这说明 CRDT 不是多维表格的必需品——它是特定性能/离线需求下的选择，而非默认方案。

| 产品 | 协作方案 | 复杂度 |
|------|---------|--------|
| Grist | **单写入者模型**（一个 Doc Worker 持有文档，所有客户端共享 Doc Action 流） | 低 |
| NocoDB | 乐观锁（版本号）+ WebSocket 广播 + Redis Pub/Sub | 低 |
| Teable | WebSocket + OT-like 冲突解决 + 单元格级变更追踪 | 中 |
| Baserow | Django Channels 频道组广播 + PostgreSQL 事务 + 乐观并发 | 低 |

---

## 二、Grist（Apache 2.0 许可）

### 2.1 最巧妙的架构决策：单写入者模型

Grist 做了一个关键的架构选择，用一个设计消除了分布式一致性问题：

```
所有编辑同一文档的用户 → 同一个 Doc Worker → 同一个 Python 数据引擎 → 同一个 SQLite 文件
```

具体流程：
1. 文档打开时，分配给**唯一的 Doc Worker**
2. 所有编辑该文档的用户通过 WebSocket 连到这个 Worker
3. 用户操作 → 发给 Worker → 转交给 Python 数据引擎（沙箱化）→ 转为 Doc Actions → 写入本地 SQLite → **广播给所有客户端**
4. SQLite 文件定期同步回 S3

**核心洞见**：因为只有一个写入者，不存在并发写冲突。协作通过"所有人接收同一个 Doc Action 流"实现。这是在架构层面解决问题，而非在算法层面（如 CRDT）。

### 2.2 文档即文件

每个 Grist 文档是一个自包含的 `.grist` 文件（SQLite 数据库），可以下载、分享、上传到另一个实例。

这个设计使备份、迁移、离线变得非常简单，不像 PostgreSQL 方案需要配套 pg_dump。

### 2.3 数据模型：元数据表模式

SQLite 文件结构：

| 表分类 | 示例 | 用途 |
|--------|------|------|
| 用户数据表 | `Table1`, `Table2`, ... | 实际电子表格数据 |
| `_grist_*` 表 | `_grist_Tables`, `_grist_Tables_column` | 元数据：表定义、列定义、视图、公式文本 |
| `_gristsys_*` 表 | `_gristsys_ActionHistory` | 操作历史、版本控制、文件附件 |

**不设置外键约束**——表之间的关联完全通过元数据表中的引用编码（如 `Ref:OtherTable`），避免协作编辑时的引用完整性问题。

### 2.4 公式引擎：Python 沙箱 + 依赖图

Grist 公式是 Python 代码，评估过程：

1. **依赖图**（Ninja 构建系统启发）：`Node` = 表中的列，`Edge` = 有向依赖
2. **行级增量重算**：只有依赖链上受影响的行才重算，不是整列
3. **动态发现依赖**：公式执行时访问字段自动跟踪，边被实时添加
4. **循环检测**：通过 `_locked_cells` 跟踪正在计算的单元格

**有意思的设计决策**：Grist 刻意不把公式翻译成 SQLite 视图（Issue #45，由项目负责人 Paul Fitzpatrick 发起讨论），因为他们认为 Python 比 SQL 更适合电子表格公式的计算语义。

### 2.5 版本控制：内建分支和合并

Grist 有类似 Git 的分支机制：
- 用户可以创建分支（`feature/`, `fix/`）独立工作
- 合并时提供可视化对比和冲突解决
- 冲突在行级、单元格级和 Schema 级检测

### 2.6 对我们项目的启示

| Grist 的选择 | 可以借鉴的点 |
|-------------|-------------|
| 单写入者模型 | 初期可以不用 CRDT，用单写入者 + 广播方式实现协作，后续按需升级 |
| 自包含文档 | 文档快照可以是自包含的 SQLite 文件，简化备份和迁移 |
| 元数据表模式 | 不直接 ALTER TABLE，而是用元数据描述 Schema，前端通过元数据解释数据 |
| 依赖图公式引擎 | 公式重算基于依赖图 + 行级增量，而非全量重算 |
| 分支/合并 | 内部版本控制比外部操作日志更直观 |

**最大启发**：Grist 证明了一个有竞争力的多维表格产品可以构建在 SQLite + 单写入者之上。不需要 CRDT，不需要 PostgreSQL，不需要分布式。

---

## 三、NocoDB（AGPL-3.0 许可）

### 3.1 架构

- 前端：Vue.js
- 后端：NestJS (Node.js)
- 查询构建：Knex.js（SQL dialect 抽象层）

### 3.2 双数据库设计

| 数据库 | 用途 |
|--------|------|
| Meta DB (`NC_DB`) | 系统配置：项目、表、列、视图、用户、过滤、排序、角色 |
| User DB | 外部数据库，存储用户创建的实际数据（支持 MySQL/PG/SQLite/MSSQL 等） |

这是 NocoDB 的核心概念——不是自己存储数据，而是给**已有数据库**加一层电子表格 UI。

### 3.3 协作：乐观锁 + WebSocket

```
用户编辑 → HTTP 请求到 NestJS → SQL UPDATE WHERE version = N
  ├── 版本匹配: 更新成功 → WebSocket 广播给所有客户端
  └── 版本不匹配: 冲突 → 自动合并非冲突字段 OR 提示手动解决
```

WebSocket Gateway (`NocoSocket`) 使用 Redis Pub/Sub 在多实例间同步消息。

### 3.4 性能边界

社区反馈的性能数据：

| 数据量 | 表现 |
|--------|------|
| < 1 万行 | 流畅 |
| ~3 万行（含查找/公式列） | API 调用 3-20 秒 |
| 数百万行 | 可浏览，但排序/筛选慢 |
| 1 亿行+（SQLite） | 表格加载需数分钟 |

主要瓶颈：`SELECT COUNT(*)` 全表扫描、缺少索引、SQLite 在 21GB 时 CPU 饱和。

### 3.5 对我们项目的启示

| NocoDB 的选择 | 可以借鉴的点 |
|--------------|-------------|
| 乐观锁协作 | 最简单可行的协作方案，适合 50 人以下 |
| 双数据库设计 | Meta 和 Data 分开存储，简化迁移和多租户 |
| Knex.js 多数据库 | 数据层通过查询构建器抽象，支持多种数据库后端 |
| 元数据描述 Schema | 和 Grist 相同思路——不变更 DDL，而是用元数据表记录定义 |

---

## 四、Baserow（MIT 许可）

### 4.1 架构

| 层 | 技术 |
|----|------|
| 前端 | Vue.js / Nuxt.js (SSR) |
| 后端 | Django + Django REST Framework (Python) |
| 数据库 | PostgreSQL |
| 实时通信 | **Django Channels**（WebSocket 支持） |
| 异步任务 | Celery + Redis |
| 部署 | Docker 容器化 |

### 4.2 协作：频道组订阅/广播模型

Baserow 的协作方案基于 Django Channels 的**频道组**机制：

```
客户端 ──WebSocket──▶ CoreConsumer (consumers.py)
                         │
                   订阅表格 {table_id}
                         │
                  加入 "table-{table_id}" 频道组
                         │
              数据变更时: send_message_to_channel_group
                         │
                  广播到组内所有订阅客户端
```

**核心源码**：`backend/src/baserow/ws/consumers.py`（WebSocket 连接管理）+ `backend/src/baserow/ws/tasks.py`（消息广播任务）

### 4.3 事件类型

| 事件 | 说明 |
|------|------|
| `row_created` | 行创建通知 |
| `row_updated` | 行更新通知 |
| `row_deleted` | 行删除通知 |
| `row_comment_created` | 行评论创建 |
| `row_comment_updated` | 评论更新 |

### 4.4 并发处理

- **PostgreSQL 事务隔离**：依赖数据库事务保证写入原子性
- **乐观并发**：变更即时广播，各客户端同步更新
- **Celery 异步解耦**：耗时操作（导出、邮件）不阻塞主进程
- **无 CRDT，无 OT Transform** — 依赖 PostgreSQL 的事务 + 广播

### 4.5 对我们项目的启示

| Baserow 的选择 | 可以借鉴 |
|---------------|---------|
| Django Channels 频道组 | 最简 WebSocket 协作方案，类似 Socket.IO room |
| PostgreSQL 事务做冲突仲裁 | 不引入额外的冲突解决层，让数据库做底层保证 |
| JSON 字段存储灵活配置 | 但不用于核心数据存储（与 JSONB 方案不同） |
| Celery 异步任务 | 耗时操作入队列的标准做法 |

**关键认知**：Baserow 的实现是最简单的协作方案——WebSocket 广播 + PostgreSQL 事务。没有 Transform 函数，没有 CRDT 数据结构，没有单写入者限制。对于低冲突场景（多人编辑不同行/列），这个方案完全够用。

---

## 五、Teable（AGPL-3.0 许可）

### 4.1 最激进的架构决策：1:1 物理表映射

Teable 做了一个与 APITable/Notion/Grist 都不同的关键选择：**UI 表直接映射到 PostgreSQL 物理表**。每个用户创建的"电子表格"就是一张真实的 PostgreSQL 表，每个"字段"就是一个真实的列。

这意味着：
- 不存 JSONB，不存 EAV，不存元数据描述
- 直接用 PostgreSQL 的 DDL 管理 Schema
- 直接用 PostgreSQL 的索引加速查询
- BI 工具（Metabase/PowerBI）可以直接连 PG 查询数据

**这是完全不同于我们当前 JSONB 方案的技术路线，但恰好是最接近我们初始 NestJS + PostgreSQL 方案的实现。**

### 4.2 架构

| 层 | 技术 |
|----|------|
| 前端 | Next.js + React + TypeScript + **自研 Canvas 表格组件** |
| 后端 | NestJS + TypeScript（与我们初始方案一致！） |
| 数据库 | PostgreSQL（原生物理表，非抽象层） |
| ORM | Prisma + TypeORM 双 ORM |
| 实时通信 | WebSocket + OT-like 冲突解决 |
| 部署 | Docker + Kubernetes |

### 4.3 公式引擎：编译到 SQL

这是 Teable 最独特的设计——**公式不通过 JS/WASM 在内存计算，而是编译为 PostgreSQL SQL**：

```
用户公式 (电子表格语法)
    ↓
ANTLR4 解析器 → AST (抽象语法树)
    ↓
Visitor 多遍遍历
    ├── 字段引用解析
    ├── 类型推导
    └── SQL 转换 (BaseSqlConversionVisitor)
    ↓
两种执行模式:
    ├── GENERATED ALWAYS AS 列 (不可变公式, 数据库预计算)
    └── SELECT CTE 表达式 (可变公式, 运行时计算)
```

**关键洞察**：公式计算被**下推到数据库层**。100 万行的 SUM 不用把数据拉到应用层再算，而是让 PostgreSQL 直接算。这是最彻底的"让数据库做它擅长的事"方案。

对比我们的方案：
| 维度 | Teable (公式→SQL) | 我们的方案 (Formualizer WASM) |
|------|-------------------|---------------------------|
| 大数据量 | 数据库层计算，无需传输数据 | 需要把数据拉到 WASM 内存 |
| 函数支持 | 78 个函数 | 320 个函数 |
| 扩展性 | 受限于 SQL 表达能力 | 可以任意扩展 |
| 部署 | 零额外组件 | 前端 WASM 加载 + 后端 Rust 引擎 |
| 一致性 | 公式结果与数据同库，天然一致 | 需要保证 CRDT 状态与公式结果一致 |

### 4.4 性能

- 百万行+ 无压力（受 PG 物理限制，非应用层限制）
- 标准 UI 操作 < 100ms
- 协作延迟 < 50ms
- 产品定位为"无行数上限"

### 4.5 对我们项目的核心启示

**Teable 是我们初始方案（NestJS + PostgreSQL）的最直接验证**：
- 它证明了 NestJS + PostgreSQL 可以构建商业级多维表格
- 它的 1:1 物理表方案比 JSONB 更简单，性能更好
- 公式→SQL 的方案值得认真评估——是否比引入 Formualizer WASM 更务实？
- 它用 WebSocket + OT-like 而不是 CRDT，同样实现了多人协作

**但需要权衡**：
- 物理表意味着每次用户创建字段都要执行 DDL（ALTER TABLE）——这在 50 列以内是安全的，但频繁变更 Schema 时需要关注
- 公式函数的数量（78）比 HyperFormula（400）和 Formualizer（320）少很多
- AGPL-3.0 许可证限制

---

## 六、综合对比与协作方案抉择

| 维度 | Grist 单写入者 | NocoDB 乐观锁 | Baserow 频道广播 | Teable OT-like | CRDT (Loro/Yjs) |
|------|--------------|-------------|-----------------|---------------|-----------------|
| 实现复杂度 | 低 | 低 | 最低 | 中 | 高 |
| 并发冲突 | 无（天然串行） | 有（版本号冲突） | 有（PG 事务仲裁） | 少（OT Transform） | 极少（LWW 自动解决） |
| 离线支持 | 弱（依赖 Server） | 弱（依赖 Server） | 弱（依赖 Server） | 弱（依赖 Server） | 强（天然支持） |
| 网络依赖 | 高 | 高 | 高 | 高 | 低 |
| 单点瓶颈 | Doc Worker | 无（可水平扩展） | 无 | 无 | 无 |
| 生产验证 | Grist SaaS | NocoDB 56K stars | Baserow 社区版 | Teable 18K stars | Figma/AppFlowy/AFFiNE |
| 适合场景 | 中小团队、文档有所有者 | 中小团队、低冲突场景 | 中大型、要SQL直连 | 大规模、高并发、离线 |

**关键洞察**：对于 MVP 阶段（10 万行、50 人），乐观锁或单写入者都是完全可行的。CRDT 的离线支持和自动冲突解决很好，但其实现复杂度和技术风险在 MVP 阶段可能超过收益。

**另一个关键洞察**：Teable 证明了 NestJS + PostgreSQL（我们最初的方案）是一个完全可行的路径。它的 1:1 物理表映射 + 公式→SQL 方案在某些维度上可能比 JSONB + WASM 公式引擎更务实。

---

## 七、两个有竞争力的 V1 技术路线对比

基于以上所有竞品分析，现在有两个值得认真评估的路线：

### 方案 A：JSONB 路线（当前方案）

```
前端: React + Canvas 渲染
后端: NestJS (TS) + PostgreSQL JSONB
  ├── 元数据表: tables, columns, views, permissions
  ├── 数据表: records (id, table_id, data JSONB, version INT)
  └── 协作: WebSocket + 乐观锁
公式引擎: HyperFormula (JS) 初期 → Formualizer (WASM) 后续
```

**优点**：灵活的动态字段，无需 DDL 变更，与 APITable 方案一致
**缺点**：JSONB 查询效率、公式需要额外组件、大规模数据时 JSONB 索引开销大

### 方案 B：物理表路线（Teable 方案）

```
前端: React + Canvas 渲染
后端: NestJS (TS) + PostgreSQL 物理表
  ├── 每个 UI 表 = 一张 PG 表
  ├── 每个字段 = 一个 PG 列
  ├── 元数据表: tables, columns_metadata, views
  └── 协作: WebSocket + 乐观锁
公式引擎: ANTLR4 解析 → 编译为 PostgreSQL SQL (Generated Columns + SELECT 表达式)
```

**优点**：数据库原生性能，公式零额外组件，标准备份/索引/BI 工具
**缺点**：字段创建需要 DDL，函数数量有限，跨表关联实现复杂

### 建议

**PoC 2（PostgreSQL 性能测试）应该同时测试这两种方案**：
1. JSONB 方案在 50 万行 × 50 列下的读写性能
2. 物理表方案在 50 万行 × 50 列下的读写性能（对比基准）
3. JSONB GIN 索引 vs 物理表 B-tree 索引的筛选加速效果
4. `ALTER TABLE ADD COLUMN` 在大表上的锁等待时间

**实际数据会决定哪种方案更适合。**

---

## 参考链接

### Grist
- [Grist GitHub](https://github.com/gristlabs/grist-core)
- [Grist Architecture Overview](https://github.com/gristlabs/grist-core/blob/main/documentation/overview.md)
- [Grist Database Documentation](https://github.com/gristlabs/grist-core/blob/main/documentation/database.md)
- [Grist Dependency Graph (depend.py)](https://code.garrettmills.dev/Archives/gristlabs_grist-core/commit/b82eec714a2e3e34f55627f3c94f5ebef11dede8?files=sandbox%2fgrist%2fdepend.py)
- [Grist Data Engine (engine.py)](https://code.garrettmills.dev/Archives/gristlabs_grist-core/src/commit/70935a4fa46cba2d324938632e9f2e014f65ba5c/sandbox/grist/engine.py)
- [SQLite Forum: Grist Architecture Discussion](https://www.sqlite.org/forum/forumpost/e66e5b6a1e35a995)
- [Grist Issue #45: SQLite View Translation](https://github.com/gristlabs/grist-core/issues/45)

### NocoDB
- [NocoDB GitHub](https://github.com/nocodb/nocodb)
- [NocoDB Architecture (DeepWiki)](https://deepwiki.com/nocodb/nocodb)
- [NocoDB Performance Discussion (#2626)](https://github.com/nocodb/nocodb/discussions/2626)
- [NocoDB Large Dataset Discussion (#4440)](https://github.com/nocodb/nocodb/discussions/4440)
- [NocoDB Ecosystem Review (#9009)](https://github.com/nocodb/nocodb/discussions/9009)

### Baserow
- [Baserow GitHub](https://github.com/bram2w/baserow)
- [Baserow 后端架构解析 (CSDN)](https://blog.csdn.net/gitblog_00820/article/details/143735423)
- [Baserow 协作引擎 (Gitcode)](https://blog.gitcode.com/bd566e09f7c22e8974bc8c0c3779f535.html)
- [Baserow Founder Chat: Tech Stack](https://community.baserow.io/t/founder-chat-what-s-baserows-underlying-tech-stack/3162/2)

### Teable
- [Teable GitHub](https://github.com/teableio/teable)
- [Teable 公式系统 (DeepWiki)](https://deepwiki.com/teableio/teable/5.2-core-package-formula-system)
- [Teable 数据新生：Postgres与Airtable的融合体](https://github.com/teableio/docs/blob/e480b5515593f0e66d6ff53aa2acc6702058c69b/zh/gao-ji-te-xing/bo-ke/shu-ju-xin-sheng-postgres-yu-airtable-de-rong-he-ti.md)
- [Teable Hacker News 讨论](https://hn.svelte.dev/item/39666865)
- [Teable 无代码多维表格特性 (阿里云)](https://developer.aliyun.com/article/1643352)
