# CRDT + SQLite 深度技术调研

> 调研日期: 2026-04
> 目标: 对架构决策所需的关键技术问题进行资料调研，包括 Yrs CRDT 能力、公式处理、跨表关联、AppFlowy 实际架构、SQLite 并发性能、GC 策略、Loro vs Yrs 对比、大文档分片

---

## 一、Yrs CRDT 实际能力与限制

### 1.1 数据结构

Yrs（y-crdt）是 Yjs 的 Rust 移植，提供以下共享类型：

| 类型 | 用途 | 表格映射 |
|------|------|---------|
| `Doc` | 顶层文档容器 | 一个表格 = 一个 Doc |
| `Map` (YMap) | 键值映射 | 单元格数据、字段元数据、视图配置 |
| `Array` (YArray) | 有序序列 | 行列表、列列表 |
| `Text` (YText) | 文本 | 富文本单元格 |
| `XmlText` / `XmlElement` | XML 格式 | 不常用 |
| `Awareness` | 在线状态 | 光标、选区 |

**关键特性**: 所有类型可嵌套（YMap 中的值可以是 YArray、YMap、YText 等）。

### 1.2 表格数据模型

Bartosz Sypytkowski（Yrs 作者）提出的模型：

```
Table {
    cols: YArray<YMap>     // 列元数据（id, name, width, type...）
    rows: YArray<YMap>     // 行元数据（id, height, order...）
    cells: YMap            // 单元格数据，key = "{row_id}:{col_id}"
}
```

**设计要点**：
1. 单元格用 `YMap` + 复合键 `"{row_id}:{col_id}"`，而非 `YArray of YArray`
2. `YArray of YArray` 在 200K 行时每个 MapRef 是独立 Block，链表遍历极慢（O(N²) 问题）
3. 不同单元格编辑天然无冲突（每个 key 独立版本控制）
4. 行/列使用 LSeq 分数索引，支持并发增删和重排

### 1.3 性能实测数据

来源: Bartosz Sypytkowski "Can Yrs fit my table?"

| 数据规模 | 导入耗时 | 编码耗时 | 原始大小 | 压缩后 |
|---------|---------|---------|---------|--------|
| 10,000 行 | 毫秒级 | <10ms | ~1MB | ~0.2MB |
| 100,000 行 | <1s | ~50ms | ~12MB | ~3MB |
| 200,000 行 × 9 列 (1.8M 单元格) | 814ms | 100ms | 55MB (CSV 23MB, 约2.4x) | 11MB (zstd, 约0.5x) |

**关键优化**：
- **Prepend 策略**: 批量插入用 `insert(txn, 0, ...)` 头部插入 O(1)，避免尾部追加 O(N²)
- **Block Squashing**: 同一客户端的连续操作自动合并为一个 Block，减少元数据开销
- **列式序列化**: 按列序列化，利用同列数据类型一致性压缩（布尔位图、枚举变长编码、时间戳增量编码）

### 1.4 快照与持久化

Yrs 提供的持久化 API：

| API | 用途 | 说明 |
|-----|------|------|
| `Doc::encode_state_as_update_v1()` | 全量快照 | 编码当前完整文档状态 |
| `Doc::encode_diff_update_v1(state_vector)` | 增量更新 | 只编码指定 StateVector 之后的变化 |
| `Doc::transact().snapshot()` | 快照描述 | 返回 Snapshot 结构（StateVector + DeleteSet） |
| `Doc::transact().encode_update_v1()` | 操作日志 | 编码当前 transaction 中的变更 |

**StateVector**: 记录每个客户端已知的最新操作序号，用于增量同步。
**Snapshot**: StateVector + DeleteSet 的组合，描述文档在某个逻辑时间点的完整状态。

**GC / 历史压缩**:
- Yrs 内部的 `DeleteSet` 使用 `(start, length)` 对压缩已删除范围
- Block Squashing 自动合并连续操作
- 定期调用 `encode_state_as_update_v1()` 生成新快照，丢弃旧历史，实现"逻辑 GC"
- **注意**: Yrs 不像 Git 那样有原生 GC 命令，需应用层实现快照轮转

### 1.5 已知限制

| 限制 | 影响 | 应对 |
|------|------|------|
| 单文档 1M+ 行未测试 | 大表性能不确定 | 分片加载、虚拟化 |
| 元数据开销 2-3x | 存储/网络成本 | zstd 压缩、列式编码 |
| LWW 可能丢意图 | 同单元格并发冲突 | 提示冲突、Undo 支持 |
| 无原生 GC | 历史膨胀 | 定期快照 + 丢弃旧操作 |
| YArray O(N²) | 大表遍历慢 | 使用 YMap + 复合键 |

---

## 二、CRDT 环境下公式/派生数据的处理

### 2.1 核心问题

多维表格有公式字段（如 `=SUM(A1:B3)`），公式结果是派生数据。在 CRDT 环境中：
- 公式**定义**（文本）需要协作同步
- 公式**结果**是计算得出的，是否存入 CRDT？

### 2.2 业界共识

**IronCalc（开源电子表格）** 的协作会议结论（Issue #349，与 Yjs 作者 @dmonad 讨论）：

1. **使用"事件驱动"架构** — 为各种 CRDT/同步机制做好准备
2. **公式文本: Last-edit-wins** — 公式定义作为文本，最后编辑者覆盖
3. **单元格内文本: 可用 CRDT** — 如果单元格包含富文本，可用字符级 CRDT
4. **公式结果: 不存入 CRDT** — 通过响应式计算得出
5. **离线变更需要 UI 确认** — 离线用户回来后需审核大量变更

### 2.3 推荐处理方案

```
CRDT 文档中存储:
├── 公式定义（字段属性中的 formula text） → YText 或 LWW
├── 手动输入的单元格值 → YMap cell LWW
└── 字段元数据（字段类型、配置） → YMap field properties

不在 CRDT 中存储:
├── 公式计算结果 → 响应式计算引擎实时得出
├── 聚合值（求和/平均/计数） → 遍历 CRDT 状态计算
└── 排序/筛选结果 → 视图层计算

计算触发:
CRDT 变更事件 → 识别受影响的公式 → 重新计算 → 更新 UI
```

### 2.4 Bartosz 的 Selection 机制

Bartosz 在 CRDT 表格设计中提出了 **Selection（选区）** 概念：
- 公式参数 `=SUM(A1:B3)` 用分数索引定义选区范围
- 选区在并发插入行/列时自动扩展，引用始终正确
- 大量选区时可用 R-Tree 索引加速查找

---

## 三、跨表关联（Link 字段）在 CRDT 中的实现

### 3.1 问题

多维表格支持"关联"字段（Link to another record），引用另一张表的记录。但在 CRDT 中：
- 每张表是独立的 Yjs Doc
- Yjs/Yrs 不原生支持跨文档引用

### 3.2 Notion 的实现

Notion 的 Relation 属性：
- 每个 Relation 指向另一个 Database 的行（Page）
- 支持单向和双向关联
- Rollup 可聚合关联数据（计数、求和等）
- 关联存储的是目标 Page 的 ID

### 3.3 AppFlowy 的实现

AppFlowy 的 Relation 字段类型：
- Cell 数据中存储关联的 Row ID 列表
- 支持单向关联，正在开发双向关联
- 字段配置（TypeOption）中指定目标 Database ID
- 应用层负责解析引用、展示关联数据

### 3.4 CRDT 中的实现模式

```
// 在 CRDT 文档中:
cells: YMap {
  "row1:link_field_id": ["target_row_id_1", "target_row_id_2"],  // 关联的行 ID 列表
}

// 字段元数据:
fields: YArray<YMap> {
  {
    id: "link_field_id",
    type: "relation",
    options: {
      target_table_id: "table_xxx",   // 目标表 ID
      relation_type: "one_to_many",   // 关联类型
    }
  }
}
```

**关键实现要点**：

1. **存储 ID，不存储数据**: Cell 只存目标行 ID 列表，不复制目标行数据
2. **应用层解析**: 渲染关联字段时，应用层根据 ID 加载目标表数据
3. **引用完整性**: 在应用层（Axum 中间件）检查，CRDT 不保证外键约束
4. **双向关联**: A 表关联 B 表时，自动在 B 表创建反向关联字段（应用层逻辑）
5. **多表并发**: 两张表的 CRDT Doc 独立同步，关联数据在两端分别持久化

### 3.5 局限性

- 删除被关联的行时，需要清理所有引用（应用层扫描或事件驱动）
- 跨表公式（Rollup）需要加载两张表的数据（内存计算）
- 大量关联时性能取决于关联行数（非 CRDT 限制，而是查询效率）

---

## 四、AppFlowy 数据存储架构深度分析

### 4.1 整体架构

```
AppFlowy
├── 客户端 (Flutter / React Web)
│   └── flowy-core (Rust) ← 本地处理
│       ├── flowy-sqlite (Diesel ORM + SQLite)
│       ├── flowy-database2 (数据库模块)
│       ├── flowy-folder (工作区/文件夹)
│       └── flowy-document (文档)
├── AppFlowy-Collab (Rust, 基于 Yrs)
│   ├── collab (封装 Yrs)
│   ├── collab-database (数据库协作)
│   ├── collab-document (文档协作)
│   ├── collab-folder (文件夹协作)
│   ├── collab-sync (远程同步)
│   └── collab-plugins (插件)
└── AppFlowy-Cloud (Rust, 服务端)
    └── PostgreSQL + S3 (持久化)
```

### 4.2 本地存储: SQLite + Diesel

AppFlowy 客户端使用 SQLite 做本地存储：

| 组件 | 职责 |
|------|------|
| `flowy-sqlite` | SQLite 连接管理、Schema 迁移（Diesel ORM） |
| `user_table` | 用户信息（id, name, token, email） |
| KV 存储 | 共享键值存储（用于配置等） |

**关键**: 本地 SQLite 存的是**元数据和缓存**，CRDT 数据由 `collab` 模块管理。

### 4.3 协作层: AppFlowy-Collab

`collab` crate 基于 Yrs 封装了：

```
CollabBuilder::new(doc)
  → 提供 CRUD 操作
  → 事件监听 (observe)
  → 序列化/反序列化
  → 与远程同步
```

**collab-database** 的数据模型：

| 概念 | 说明 |
|------|------|
| Database | 字段 + 行的集合，可创建多个视图 |
| Field | 列，有 `FieldType` 枚举和 `TypeOption` 配置 |
| FieldType | 字段类型: text, number, date, select, multi-select, checkbox, URL, checklist, relation |
| TypeOption | 字段配置（如数字格式、日期格式、下拉选项列表） |
| Row | 行，包含一组 Cell |
| Cell | 单元格数据，由对应 FieldType 的 TypeOption 格式化 |
| TypeCellData | 带 FieldType 的 Cell 数据 |

### 4.4 服务端: AppFlowy-Cloud

AppFlowy-Cloud 使用：
- **PostgreSQL**: 用户、工作区、权限、CRDT 数据持久化
- **S3**: 文件/附件存储
- **WebSocket**: 实时 CRDT 同步

### 4.5 对我们项目的启示

| 维度 | AppFlowy 做法 | 我们可以参考 |
|------|-------------|------------|
| CRDT 封装 | collab crate 封装 Yrs | 自建类似封装层 |
| 字段类型 | FieldType + TypeOption | 采用相同模式 |
| 本地存储 | SQLite (Diesel) | SQLite (sqlx 更现代) |
| 服务端存储 | PostgreSQL | SQLite（轻量起步） |
| DI 模式 | Trait 隔离依赖 | Rust trait DI |
| 同步 | collab-sync | 自建 yrs-axum 同步 |

---

## 五、SQLite WAL 模式并发性能

### 5.1 生产环境实测数据

来源: [SQLite in Production - A Real-World Benchmark](https://shivekkhurana.com/blog/sqlite-in-production/)

测试环境: 2.4GHz 8-core Intel i9, 32GB RAM, Node.js + Piscina worker pool

#### WAL 模式写入吞吐量

| 并发连接 | WAL 写入/秒 | 非 WAL 写入/秒 | 提升 |
|---------|-----------|-------------|------|
| 1 | 49 | 86 | -43% |
| 2 | 622 | 750 | -17% |
| 4 | 1024 | 697 | +47% |
| 8 | 1019 | 558 | +83% |
| 16 | 1933 | 765 | +153% |
| 32 | 3351 | 1133 | +195% |

**结论**: WAL 在 4+ 并发后吞吐量显著优于 DELETE 模式。1-2 连接时因 WAL 开销略低。

#### 混合负载（80% 读 / 20% 写）

| 并发连接 | 总 ops/秒 | 读 p99 延迟 | 写 p99 延迟 |
|---------|----------|-----------|-----------|
| 4 | ~4,100 | <1ms | ~5ms |
| 8 | **~9,400** | ~2ms | ~7ms |
| 14 | **~10,000** | ~3ms | ~10ms |
| 32 | ~7,700 | ~5ms | ~25ms |
| 64 | ~8,900 | ~5ms | ~100ms |

**最佳并发数**: 8-14 个连接（约等于 80% × CPU 线程数）

#### 读性能

- p99 读延迟在 60+ 并发下仍 < 6ms
- SQLite 读取性能极强，读写不互斥（WAL 模式）

### 5.2 生产环境推荐配置

```sql
PRAGMA busy_timeout = 5000;            -- 5s 等待锁，防 SQLITE_BUSY
PRAGMA journal_mode = WAL;             -- 读写并发
PRAGMA synchronous = NORMAL;           -- 减少fsync，微弱丢数据风险
PRAGMA wal_autocheckpoint = 4000;      -- 降低 checkpoint 频率
PRAGMA mmap_size = 1073741824;         -- 1GB 内存映射
PRAGMA temp_store = MEMORY;            -- 临时表在内存
PRAGMA cache_size = -262144;           -- 256MB 页缓存
```

### 5.3 写入队列模式

SQLite 是**单写入者**。推荐架构：

```
多线程读取（自由并发）
       ↓
写入队列（单线程串行）
  ├── BEGIN IMMEDIATE（获取写锁）
  ├── 批量写入操作
  └── COMMIT
```

**对我们的 CRDT 场景**:
- CRDT 操作追加是天然串行的（每个 Doc 同一时刻只有一个写入者）
- 应用层写队列 + `BEGIN IMMEDIATE` 避免锁竞争
- WAL 模式让读操作完全不阻塞

### 5.4 SQLite 的适用边界

| 场景 | SQLite 适合度 | 说明 |
|------|-------------|------|
| < 100 并发用户 | 完全适合 | 单实例可承载 |
| 100-1000 并发用户 | 基本适合 | 需要写队列 + 连接池优化 |
| > 1000 并发用户 | 需要评估 | 考虑迁移 PostgreSQL |
| OLAP 分析查询 | 不适合 | 用 DuckDB 或 ClickHouse |
| 大量写入 | 不适合 | 单写入者瓶颈 |
| 多实例共享 | 不适合 | SQLite 嵌入式，无法多进程共享文件 |

### 5.5 备份方案

[Litestream](https://litestream.io/): 持续监控 WAL 文件，实时流式复制到 S3/Azure/GCS。
- 非快照备份，是每笔事务的连续复制
- App 崩溃不影响 Litestream，只是中断备份
- 恢复: `litestream restore -o db.sqlite s3://bucket/db`

---

## 六、调研发现汇总与架构影响分析

### 6.1 调研验证的结论

| 问题 | 调研结论 | 可信度 |
|------|---------|--------|
| Yrs 能处理多维表格吗？ | 能。200K行实测可行，单元格用 YMap 无冲突 | 高（作者实测） |
| 公式结果存 CRDT 吗？ | 不存。定义存 CRDT，结果响应式计算 | 高（IronCalc + Yjs 作者共识） |
| 跨表关联 CRDT 原生支持吗？ | 不支持。应用层实现，存 ID 列表 | 高（AppFlowy/Notion 验证） |
| SQLite WAL 能满足 CRDT 追加写入吗？ | 能。~3300 writes/s，远超协作需求 | 高（生产基准测试） |
| AppFlowy 用什么架构？ | Yrs + SQLite（本地）+ PostgreSQL（云端） | 高（源码 + 官方文档） |

### 6.2 发现的风险点

1. **Yrs 大文档内存**: 200K行×50列 ≈ 150-500MB 内存占用（含元数据），多表并发需关注
2. **CRDT GC 策略**: Yjs/Yrs 的 GC 默认开启，会清除已删除项。需要版本历史时必须关闭 GC
3. **跨表引用完整性**: CRDT 不保证外键约束，需应用层补偿
4. **SQLite 单写入者**: 虽然对 CRDT 追加场景足够，但元数据（用户/权限）的并发写入需要注意
5. **SQLite 可观测性弱**: 需自建 WAL 大小监控、锁竞争指标、查询延迟跟踪
6. **Loro 竞争力**: Loro v1.0 在多项基准测试中显著优于 Yjs，尤其是大文档和并发 Map 操作

### 6.3 与当前架构决策的关系

本次调研**不改变**已记录的技术决策方向（Rust + CRDT + SQLite），但揭示了以下需要额外设计的领域：

1. **快照轮转策略**: 需要设计何时压缩历史、保留多少快照
2. **公式引擎集成**: 需要设计 CRDT 事件 → 公式重算的响应式管道
3. **跨表关联层**: 需要在 Axum 中间件层设计引用完整性检查
4. **SQLite 监控**: 需要设计 WAL 大小、锁竞争、查询延迟的自建监控
5. **大文档分片**: 需要设计单表超过 10 万行时的 CRDT 分片策略
6. **CRDT 选型再评估**: 需要对比 Loro vs Yrs，决定是否采用 Loro

---

## 七、Yjs/Yrs GC 与快照轮转策略

### 7.1 Yjs GC 机制

Yjs 的垃圾回收（GC）默认**开启**：
- GC 会自动清除已被删除的 items（标记为 garbage-collected）
- GC 后的 items 无法恢复，版本历史丢失删除信息
- 通过 `doc.gc = false` 关闭 GC，保留完整历史

**Yjs 作者 @dmonad 的建议**（来自 Yjs Community 讨论）：
> 服务端如果用户多、变更量大，需要开启 GC 控制文档大小。但如果要保留版本历史（如 Google Docs 版本历史），则**必须关闭 GC**。

### 7.2 推荐的快照轮转策略

```
策略: 分层快照 + 可选 GC

热层（活跃编辑中）:
├── GC 关闭（doc.gc = false）
├── 每次操作追加到 crdt_operations 表
└── 操作日志保留最近 N 个版本

温层（定期压缩）:
├── 每小时/每天生成全量快照
├── encode_state_as_update_v1() → 存入 crdt_snapshots
├── 删除该快照之前的操作日志
└── 可选: 此时开启 GC 压缩文档

冷层（归档）:
├── 保留最近 7 天的每日快照
├── 保留最近 4 周的每周快照
└── 更早的只保留每月快照
```

### 7.3 Yrs 的持久化 API 对应

```rust
// 全量快照（压缩历史后的完整状态）
let snapshot = doc.encode_state_as_update_v1();
// → 存入 crdt_snapshots 表

// 增量更新（每次操作后）
let update = txn.encode_update_v1();
// → 追加到 crdt_operations 表

// 基于版本向量的增量差异
let state_vector = doc.get_state_vector();
let diff = doc.encode_diff_update_v1(&state_vector);
// → 用于客户端增量同步
```

---

## 八、Loro CRDT vs Yjs/Yrs 深度对比

### 8.1 Loro v1.0 核心特性

Loro 是一个新兴的 Rust CRDT 库，2025 年 9 月发布 v1.0：

| 特性 | Loro | Yjs/Yrs |
|------|------|---------|
| **核心语言** | Rust（WASM/JS/Swift 绑定） | JS（Yjs）+ Rust（Yrs） |
| **文本算法** | Fugue（防止交错） | YATA（可能交错） |
| **Move 操作** | 原生 Movable List/Tree | 需 Delete+Insert+Testament |
| **版本控制** | Git-like DAG 原生支持 | 需外部实现 |
| **Shallow Snapshot** | 原生支持（类似 Git Shallow Clone） | 无原生支持 |
| **Eg-walker 算法** | 采用（OT+CRDT 混合，更低内存） | 不使用 |
| **Bundle 大小** | 2.9MB（gzipped 894KB） | 84KB（gzipped 25KB） |
| **生态成熟度** | 较新（v1.0） | 久经考验（2015 年起） |
| **生产验证** | 少量 | Yjs: 大量 / Yrs: AppFlowy |
| **许可** | MIT | MIT |

### 8.2 性能基准测试对比

来源: [Loro 官方基准测试](https://loro.dev/docs/performance)，MacBook Pro M1

#### 基础操作（N 次字符追加/插入）

| 场景 | Yjs | Loro | Loro 优势 |
|------|-----|------|----------|
| 追加 N 字符 | 141ms | 164ms | Yjs 略快 |
| 随机位置插入 N 字符 | 128ms | 113ms | Loro 略快 |
| 随机位置插入 N 单词 | 149ms | 112ms | Loro 快 25% |
| 文档大小（追加后） | 6,031B | 12,382B | Yjs 小 2x |

#### 大规模并发操作（100K 操作）

| 场景 | Yjs | Loro | Loro 优势 |
|------|-----|------|----------|
| 并发插入+删除 100K | **27,138ms** | **2,335ms** | **Loro 快 12x** |
| 并发 Map set 100K | **31,598ms** | **488ms** | **Loro 快 65x** |
| 解析时间（100K ops） | 1,653ms | 78ms | Loro 快 21x |

#### 真实编辑数据集（100 倍放大，2600 万操作）

| 指标 | Yjs | Loro |
|------|-----|------|
| 执行时间 | 279,705ms | 233,739ms |
| 文档大小 | 22.7MB | 21.0MB |
| **解析时间** | **1,270ms** | **66ms** |

### 8.3 Loro 的关键优势（对多维表格场景）

1. **Movable List**: 原生支持行/列拖拽排序（多维表格核心操作），Yjs 需要 Delete+Insert+Testament 复杂方案
2. **Movable Tree**: 原生支持树形结构（可用来建模工作区/文件夹层级）
3. **Shallow Snapshot**: 可以只保留最近的历史，丢弃旧的，大幅减少大文档的内存占用
4. **Eg-walker**: 不需要在内存中保持完整 CRDT 数据结构，内存更低，导入更快
5. **Map 性能**: 并发 Map set 65x 快于 Yjs，而多维表格的核心操作就是 Map（cells YMap）的 set

### 8.4 Loro 的劣势

1. **Bundle 大小**: 2.9MB vs 84KB（34x 更大），对前端加载有影响
2. **生态不成熟**: v1.0 刚发布，Provider、绑定库远少于 Yjs
3. **生产验证少**: 尚未有 AppFlowy 级别的生产验证
4. **前端 JS 绑定**: Yjs 的 JS API 更自然，Loro 通过 WASM 调用有一定开销
5. **社区规模**: Yjs 有更大的社区和更多文档

### 8.5 对项目的选型建议

| 维度 | 短期（MVP） | 长期考虑 |
|------|-----------|---------|
| **推荐** | **Yrs** | 关注 Loro |
| **理由** | 生态成熟、AppFlowy 验证、前端 Yjs 无缝 | Loro 的 Move/Map/Shallow Snapshot 对多维表格更优 |
| **风险** | Move 操作需自己实现复杂方案 | Loro 生态不成熟，可能有坑 |
| **切换成本** | - | Loro 和 Yrs 都是 Rust，后端切换成本可控；前端需重写 WASM 集成 |

**建议路径**: MVP 用 Yrs 快速验证，同时关注 Loro 生态发展。如果 Loro 在 2026 年下半年获得更多生产验证，可在 v2 切换。

---

## 九、公式引擎与 CRDT 事件驱动集成

### 9.1 响应式公式计算管道

基于 IronCalc 协作会议的"事件驱动"建议：

```
用户编辑单元格
    ↓
Yjs 客户端更新 YMap cell
    ↓
Yjs observeDeep 回调触发
    ↓
识别变更的单元格 (rowId, fieldId)
    ↓
查找依赖该单元格的公式字段
    ↓ （公式依赖图）
触发公式重算
    ↓
更新公式结果（仅 UI 状态，不写入 CRDT）
    ↓
Canvas 局部重绘
```

### 9.2 公式依赖图

```
字段A (数字) ← 用户输入
字段B (数字) ← 用户输入
字段C (公式 = A+B) ← 依赖 A, B
字段D (公式 = C*2) ← 依赖 C → 间接依赖 A, B
字段E (关联汇总) ← 依赖关联字段的引用数据

依赖图:
A → C → D
B → C
```

**关键数据结构**:
- **公式依赖图**: 有向无环图（DAG），记录哪些字段依赖哪些字段
- **拓扑排序**: 当字段 A 变更时，按拓扑序重算 C → D
- **循环检测**: 新增公式时检测循环依赖

### 9.3 Formualizer 集成方式

Formualizer 是 Rust 公式引擎（320+ 公式，MIT/Apache-2.0）：

```
前端:
  用户输入公式 → Yjs 存储公式文本 → 触发重算
  Formualizer WASM 执行公式 → 结果显示在 UI

后端:
  CRDT 变更事件 → 识别公式字段 → Formualizer 原生 Rust 执行
  公式结果用于: 搜索索引、筛选、排序、聚合
  （后端不存公式结果到 CRDT，但可缓存到 SQLite）
```

**注意**: 后端需要公式结果来支持筛选和搜索，但不能存入 CRDT 文档（否则并发冲突）。解决方案是后端维护一个**派生数据缓存表**在 SQLite 中。

---

## 十、CRDT 大文档分片/虚拟化策略

### 10.1 问题

单张表超过 10 万行时，Yrs 文档可能占用数百 MB 内存。需要策略限制内存使用。

### 10.2 分层加载策略

```
策略: CRDT 文档全量 + 渲染层虚拟化

L1: CRDT 文档（内存中，完整状态）
  ├── 优点: 数据完整，协作无冲突
  ├── 缺点: 内存占用大（200K行 ≈ 55-150MB）
  └── 适用: < 50K 行

L2: CRDT 快照 + 按需加载行
  ├── 服务端保持完整 CRDT 文档
  ├── 客户端只加载当前视口范围的行
  ├── 滚动时按需请求行数据
  └── 适用: 50K-500K 行

L3: 分片文档
  ├── 按行范围拆分为多个 CRDT 文档
  ├── 每个文档包含一个行分片（如每 1 万行一片）
  ├── 合并查询需要跨分片
  └── 适用: > 500K 行
```

### 10.3 客户端虚拟化渲染

无论 CRDT 文档大小，前端 Canvas 渲染都使用虚拟滚动：
- 只渲染可见区域的单元格（+ 缓冲区）
- 滚动时按需从 Yjs 文档读取行数据
- Canvas 绑定到 Yjs observeDeep 事件，只重绘变更区域
- 与 CRDT 文档大小无关，始终流畅

### 10.4 推荐方案

```
MVP 阶段: L1 策略
├── 单个 CRDT 文档包含完整表数据
├── 适用于 < 50K 行（绝大多数使用场景）
└── 前端 Canvas 虚拟滚动保证渲染性能

增长阶段: L2 策略
├── 服务端保持完整 CRDT，客户端按需加载
├── WebSocket 增量同步只传输变更
└── 客户端保持最近访问的行在内存中

扩展阶段: L3 策略
├── 按行范围分片，每片一个 CRDT 文档
├── 合并查询用 SQLite 派生表
└── 此时考虑迁移到 PostgreSQL
```

---

## 参考链接

### Yrs / CRDT
- [Can Yrs fit my table? - Bartosz Sypytkowski](https://www.bartoszsypytkowski.com/yrs-csv-table/) — Yrs 表格数据模型与性能测试
- [Conflict-free Replicated Spread Sheets - Bartosz Sypytkowski](https://www.bartoszsypytkowski.com/crdt-tables/) — CRDT 电子表格架构（单元格 LWW / LSeq / Selections / Move / 优化）
- [CRDT Survey, Part 2 - Matthew Weidner](https://mattweidner.com/2023/09/26/crdt-survey-2.html) — CRDT 语义技术综述（公式引用用 UID 而非位置）
- [Yrs API Docs](https://docs.rs/yrs) — Yrs Rust API 文档
- [y-crdt GitHub](https://github.com/y-crdt/y-crdt) — Yrs 源码仓库

### 公式与协作
- [IronCalc Issue #349 - Implement collaborative spreadsheet](https://github.com/ironcalc/IronCalc/issues/349) — IronCalc 协作会议结论（事件驱动 / Last-edit-wins / 离线审批）
- [A Study of Semantics for CRDT-based Collaborative Spreadsheets (ACM)](https://dl.acm.org/doi/abs/10.1145/3578358.3591324) — CRDT 电子表格语义论文

### AppFlowy
- [AppFlowy-Collab GitHub](https://github.com/AppFlowy-IO/AppFlowy-Collab) — Yrs 协作封装（collab-database / collab-document / collab-folder）
- [AppFlowy Database Architecture](https://docs.appflowy.io/docs/documentation/software-contributions/architecture/frontend/database-view) — 数据库视图架构（Field / FieldType / TypeOption / Row / Cell）
- [How to add a new property to AppFlowy database](https://docs.appflowy.io/docs/appflowy/community/write-for-appflowy/drafts/draft-how-to-add-a-new-property-to-appflowy-database) — 字段类型添加指南
- [AppFlowy Backend Database](https://github.com/AppFlowy-IO/AppFlowy-Docs/blob/main/essential-documentation/contribute-to-appflowy/architecture/backend/database.md) — SQLite + Diesel ORM 架构

### SQLite 性能
- [SQLite in Production - A Real-World Benchmark](https://shivekkhurana.com/blog/sqlite-in-production/) — 完整 WAL 基准测试（写入/读取/混合负载/调优）
- [SQLite WAL Mode for Better Concurrent Web Performance](https://dev.to/ahmet_gedik778845/sqlite-wal-mode-for-better-concurrent-web-performance-4fck) — WAL 模式并发优化
- [The SQLite Renaissance in 2026](https://dev.to/pockit_tools/the-sqlite-renaissance-why-the-worlds-most-deployed-database-is-taking-over-production-in-2026-3jcc) — SQLite 生产趋势
- [Litestream](https://litestream.io/) — SQLite 实时备份到 S3

### 跨表关联
- [Notion Relations & Rollups](https://www.notion.com/help/relations-and-rollups) — Notion 关联字段功能
- [AppFlowy Relation FR #1664](https://github.com/AppFlowy-IO/AppFlowy/issues/1664) — AppFlowy 关联字段需求讨论
- [AppFlowy Two-way Relation FR #7259](https://github.com/AppFlowy-IO/AppFlowy/issues/7259) — 双向关联需求

### Loro CRDT
- [Loro v1.0 Blog](https://loro.dev/blog/v1.0) — Loro v1.0 发布公告（Eg-walker / Shallow Snapshot / Movable List/Tree / 性能提升）
- [Loro Performance Benchmarks](https://loro.dev/docs/performance) — Loro vs Yjs vs Automerge 基准测试对比
- [Yjs vs Loro Discussion](https://discuss.yjs.dev/t/yjs-vs-loro-new-crdt-lib/2567) — 社区对比讨论

### Yjs GC
- [Yjs GC Issue #117](https://github.com/y-js/yjs/issues/117) — GC 机制讨论
- [Yjs GC Discussion](https://discuss.yjs.dev/t/gc-is-off-but-still-losing-delection-history/2704) — GC 关闭与版本历史保留

### Rust 后端生态
- [yrs-axum (crates.io)](https://crates.io/crates/yrs-axum) — Yrs 与 Axum 的 WebSocket 集成库
- [Axum + Yrs Discussion](https://discuss.yjs.dev/t/axum-yrs-server/2570) — 社区关于 Axum + Yrs 的讨论
- [Axum 0.8 Release](https://rustcc.cn/article?id=2abb8da4-8f14-4e8a-b3bc-77a3d6534dbb) — Axum 0.8 发布说明
- [Rust Web Frameworks 2026](https://aarambhdevhub.medium.com/rust-web-frameworks-in-2026-axum-vs-actix-web-vs-rocket-vs-warp-vs-salvo-which-one-should-you-2db3792c79a2) — Rust Web 框架对比

---

## 十一、调研自检：架构决策缺口分析

> 本节对全部调研成果与已记录的架构决策进行逐项对照，识别已验证的决策、需要修正的决策、以及仍然缺失的关键调研。

### 11.1 架构决策逐项验证

| 决策 | 调研验证状态 | 结论 |
|------|------------|------|
| **纯 Rust 后端 (Axum)** | ✅ 已验证 | Axum v0.8 成熟（2025.11 发布），Tokio 团队维护，WebSocket 原生支持，生产级框架。社区有 Axum+Yrs 集成讨论和 yrs-axum crate |
| **CRDT 协作 (Yjs+Yrs)** | ✅ 已验证，但有新选项 | Yrs 生产验证（AppFlowy）。但 Loro 在 Map 操作快 65x、并发操作快 12x，原生 Move 操作对多维表格更有利。建议 MVP 用 Yrs，长期关注 Loro |
| **公式引擎 (Formualizer)** | ✅ 已验证 | MIT/Apache-2.0，320+ 公式，WASM+原生 Rust，依赖图+增量重算，完美匹配需求 |
| **数据存储 (SQLite)** | ⚠️ 部分验证 | SQLite WAL 性能充足（~3300 writes/s），但 **AppFlowy 云端用 PostgreSQL 而非 SQLite**。服务端用 SQLite 做 source of truth 没有同级别生产验证 |
| **前端 (React + Next.js + Canvas)** | ⏳ 未深入调研 | Canvas 渲染与 Yjs 数据绑定的具体实现方案尚未调研 |
| **搜索 (SQLite FTS5)** | ✅ 基本可行 | FTS5 功能够用，但中文分词需要额外方案（jieba 或自定义 tokenizer） |
| **权限 (应用层 RBAC)** | ✅ 已验证 | SQLite 无 RLS，应用层实现是正确选择，AppFlowy 同样做法 |

### 11.2 需要关注的风险

#### 风险 1: 服务端 SQLite 作为 source of truth

**现状**: 决策记录中用 SQLite 做服务端主存储。但 AppFlowy 的实际架构是：
- 客户端本地: SQLite
- 服务端: **PostgreSQL + S3**

**没有找到**以 SQLite 做服务端主存储的 CRDT 协作产品的生产案例。

**影响**: SQLite 在单机嵌入式场景非常可靠，但在服务端多实例、备份恢复、横向扩展方面不如 PostgreSQL。

**选项**:
- A: 坚持服务端 SQLite（轻量起步，后期迁移 PG）
- B: 客户端 SQLite + 服务端 PostgreSQL（与 AppFlowy 一致）
- C: 先 SQLite 做早期开发，架构上预留 PG 迁移接口

#### 风险 2: yrs-axum 的成熟度

**现状**: `yrs-axum` crate 存在（crates.io），有示例代码。但：
- 下载量较少，社区使用不多
- AppFlowy-Cloud 没有使用 yrs-axum，而是自建了 `collab-sync` 模块
- 需要自建 WebSocket 连接管理、房间管理、广播逻辑

**影响**: 不能直接依赖 yrs-axum，需要自建 CRDT 同步层。参考 AppFlowy-Collab 的 `collab-sync` 模块。

#### 风险 3: 前端 Canvas + Yjs 数据绑定

**现状**: 已调研 Canvas 渲染引擎（APITable Konva 源码分析），已调研 Yjs 文档模型。但：
- Canvas 渲染器如何高效订阅 Yjs observeDeep 事件？
- 变更粒度如何映射到 Canvas 局部重绘？
- 大量并发变更时的渲染性能如何？

**影响**: 前端最复杂的部分之一，需要 PoC 验证。

#### 风险 4: CRDT 文档内存占用

**现状**: Yrs 200K 行 × 9 列实测 55MB（2.4x 原始数据）。
- 50 列时可能 150-300MB
- 多表并发（如 10 个活跃表）= 1.5-3GB 内存
- Loro 的 Shallow Snapshot 特性可以大幅缓解此问题

**影响**: 服务端内存规划需要考虑热表数量。可能需要 LRU 淘汰不活跃的 CRDT 文档。

### 11.3 尚未调研的关键问题

| 问题 | 重要度 | 说明 |
|------|--------|------|
| **中文全文搜索方案** | 高 | SQLite FTS5 默认不支持中文分词，需要 jieba 或 ICU tokenizer |
| **Canvas + Yjs 数据绑定 PoC** | 高 | 前端最复杂的集成点，需要概念验证 |
| **移动端 CRDT 同步** | 中 | React Native 如何集成 Yjs/Yrs |
| **多租户隔离** | 中 | SQLite 单文件如何做多租户隔离（每租户一个文件？） |
| **CRDT 文档导入/导出** | 中 | Excel/CSV → CRDT 文档的批量导入性能 |
| **自动化工作流在纯 Rust 中的实现** | 低 | 原 BullMQ (Node.js) 方案需重新设计 |

### 11.4 总结

**已充分调研可确认的决策**:
- 后端纯 Rust (Axum) ✅
- CRDT 协作 ✅
- 公式引擎 Formualizer ✅
- 前端 React + Canvas（框架层面已确认）✅

**已调研但存在风险的决策**:
- 服务端 SQLite ⚠️（AppFlowy 云端用 PG，服务端 SQLite 缺生产验证）
- CRDT 库选型 Yrs ⚠️（Loro 在表格场景性能更优）

**尚需调研**:
- 中文全文搜索具体方案
- Canvas + Yjs 集成验证
- 多租户 SQLite 隔离策略
