# 文件存储方案 & Apache Arrow 技术路线

## 你的核心想法
如果多维表格不使用传统数据库，而是以**文件形式**存储数据，会怎样？
- 能否用 **Apache Arrow** 列式格式做底层存储？
- 浏览器端能否直接操作列式数据？
- 性能和灵活性如何平衡？

## Apache Arrow 是什么
- **列式内存格式规范**，语言无关
- Zero-copy 零拷贝读取，无序列化/反序列化
- SIMD友好的内存布局，cache高效
- 支持 Arrow IPC (流式传输) 和 Parquet (磁盘存储)
- 有 JS/TS, Rust, Go, Python, Java 等全语言SDK

## Arrow + DuckDB WASM: 浏览器内数据库

### 核心发现
**DuckDB-WASM** 是在浏览器中运行的完整分析型SQL数据库:
- 编译为 WebAssembly，在浏览器中运行
- 原生支持 Apache Arrow 数据格式
- 支持 Parquet 文件读写
- 可以在 Web Worker 中运行，不阻塞UI
- Arrow IPC buffer 可零拷贝传输到 Worker

### 架构方案
```
┌──────────── 浏览器 ────────────┐
│  UI层 (React)                  │
│  表格渲染 / 视图切换            │
├────────────────────────────────┤
│  Web Worker                    │
│  ┌──────────────────────────┐  │
│  │  DuckDB-WASM             │  │
│  │  ├── SQL查询引擎          │  │
│  │  ├── Arrow 列式内存       │  │
│  │  ├── Parquet 读写         │  │
│  │  └── 公式计算 / 聚合分析   │  │
│  └──────────────────────────┘  │
├────────────────────────────────┤
│  存储层                        │
│  ├── IndexedDB (本地持久化)    │
│  ├── OPFS (Origin Private FS) │
│  └── Arrow IPC / Parquet文件   │
├────────────────────────────────┤
│  同步层                        │
│  WebSocket → 服务端同步        │
│  CRDT/OT 冲突解决              │
└────────────────────────────────┘
```

## 两种存储策略对比

### 方案A: 纯文件存储 (你提出的方向)
```
每个数据表 → 一个 Arrow/Parquet 文件
浏览器: DuckDB-WASM 直接查询文件
服务端: 文件存储 + 版本管理
```

| 优点 | 缺点 |
|------|------|
| 无需数据库运维 | 多人并发写入复杂 |
| 列式存储分析性能极好 | 小数据量不如JSONB灵活 |
| 文件可复制/迁移/备份 | 实时协作需要额外机制 |
| 浏览器端零依赖分析 | 事务支持弱 |
| 天然支持离线 | 全文搜索不如PG |

### 方案B: PostgreSQL + Arrow 混合 (推荐探索)
```
OLTP (增删改): PostgreSQL JSONB
OLAP (分析): DuckDB + Arrow (浏览器端或服务端)
同步: PG → Arrow 导出 → 浏览器分析
```

| 优点 | 缺点 |
|------|------|
| 写入走PG，事务安全 | 架构复杂 |
| 分析走Arrow，性能极好 | 数据同步机制 |
| 各取所长 | 运维成本 |

### 方案C: 纯浏览器端 (Local-First 极致方案)
```
本地: DuckDB-WASM + IndexedDB/OPFS
同步: CRDT (Yjs) → P2P或服务端
服务端: 仅做中继和持久化，不存业务数据
```

| 优点 | 缺点 |
|------|------|
| 离线完全可用 | 服务端分析困难 |
| 隐私安全 | 多设备同步复杂 |
| 零服务端成本 | 数据备份风险 |
| 响应极快 | 不适合团队协作的大数据场景 |

## Apache Arrow 在多维表格中的具体价值

### 1. 数据分析
```javascript
// 浏览器中直接用SQL分析数据
const db = new duckdb.DuckDB(new duckdb.AsyncDuckDB());
await db.exec(`
  SELECT category, SUM(amount), AVG(amount)
  FROM my_table
  GROUP BY category
  ORDER BY SUM(amount) DESC
`);
// 结果以 Arrow 格式返回，零拷贝
const result = await db.arrowResult();
```

### 2. 数据传输
```
服务端PG → 导出Arrow IPC → WebSocket → 浏览器DuckDB-WASM
全链路零拷贝，性能极高
```

### 3. 文件导入导出
```
Excel → Arrow (服务端/浏览器端转换)
Parquet文件 → 直接在DuckDB中查询
导出 → Arrow/Parquet/CSV 一键完成
```

## 推荐策略
```
阶段1: PostgreSQL为主，满足核心功能
阶段2: 引入DuckDB-WASM做浏览器端分析
       PG数据 → Arrow格式 → 浏览器分析
阶段3: 探索Local-First模式
       服务端仅做同步中继
       本地DuckDB做所有计算
```

## 参考链接
- [Apache Arrow JS官方](https://arrow.apache.org/js/)
- [DuckDB-WASM官方博客](https://duckdb.org/2021/10/29/duckdb-wasm.html)
- [DuckDB+Arrow+WebWorker实践](https://motifanalytics.medium.com/my-browser-wasmt-prepared-for-this-using-duckdb-apache-arrow-and-web-workers-in-real-life-e3dd4695623d)
- [高性能统计仪表盘](https://medium.com/@ryanaidilp/building-a-high-performance-statistical-dashboard-with-duckdb-wasm-and-apache-arrow-d6178aeaae6d)
- [DuckDB零拷贝Arrow集成](https://duckdb.org/2021/12/03/duck-arrow.html)
- [Arrow IPC数据传输到浏览器](https://stackoverflow.com/questions/74999055/what-is-the-best-way-to-send-arrow-data-to-the-browser)
- [DuckDB vs SQLite对比](https://www.datacamp.com/blog/duckdb-vs-sqlite-complete-database-comparison)
- [SQLite vs DuckDB选择](https://medium.com/@kaushalsinh73/when-to-use-sqlite-instoml-instead-of-duckdb-7e1beb89c344)
- [Awesome Local-First](https://github.com/alantriesagain/awesome-local-first)
- [Turso - 数据库无处不在](https://turso.tech/)
