# 多维表格项目 - 研究笔记

## 项目目标
对标 Notion 和飞书多维表格，开发一个可替代公司所有系统的多维表格产品。

## 核心概念
- **多维表格** = 数据库 + 电子表格 + 项目管理 + 工作流
- 多维 = 多种视图（表格、看板、甘特图、日历、表单、画廊等）
- 核心差异化：关系型数据能力 + 灵活视图 + 自动化工作流

## 已完成的研究
### 第一轮: 基础调研
- [x] 开源项目调研: APITable, NocoDB, Baserow, Teable
- [x] Notion Block模型详解（官方博客全文整理）
- [x] 飞书多维表格产品功能梳理
- [x] 实时协作方案: CRDT(Yjs/Automerge) vs OT
- [x] 公式引擎: ~~HyperFormula(推荐)~~ → Formualizer(Rust+WASM, MIT/Apache-2.0) -- HyperFormula实为GPLv3，已更正
- [x] 前端性能: 虚拟滚动 + Canvas + Web Workers
- [x] 数据存储方案: PostgreSQL + JSONB 分层架构
- [x] APITable Snapshot 数据结构详解
- [x] 数据分析存储方案(聚合/分组/筛选, 分数据量级)
- [x] EAV vs JSONB vs 动态DDL 深度对比
- [x] 权限模型: 行列级安全 + RBAC
- [x] Univer 前端表格引擎
- [x] 视图系统设计: 6种视图

### 第二轮: 功能扩展
- [x] 自动化工作流引擎: Trigger→Condition→Action模型
- [x] 导入/导出: Excel/CSV流式处理+批量写入
- [x] 搜索引擎: PG原生→Meilisearch→Elasticsearch分阶段
- [x] 版本控制与撤销重做: Changeset+Snapshot方案
- [x] Webhook与事件系统: 事件驱动+消息队列+可靠推送

### 第三轮: 工程&部署
- [x] 插件/扩展系统: Widget SDK + iframe沙箱 + 自定义字段类型
- [x] 技术选型: TypeScript全栈(Next.js + NestJS)推荐
- [x] 部署方案: 私有化→多租户→SaaS 分阶段
- [x] 数据库扩展: PG分区→读写分离→Citus→OLAP 引擎
- [x] 移动端适配: 响应式Web+PWA(初期) → React Native(中期)

### 第四轮: 深度补充
- [x] AI能力集成: 智能字段提取/自然语言查询/AI工作流, 分三层引入
- [x] API设计: RESTful + WebSocket(推荐) vs GraphQL, 完整端点设计
- [x] 前端组件库: Ant Design推荐(200+组件,中文生态好), 表格自研Canvas
- [x] 测试策略: 测试金字塔(70/20/10), Playwright适合协作场景多Tab测试
- [x] 可观测性: OpenTelemetry + Prometheus + Grafana, 分阶段实施
- [x] 国际化: 初期中文,代码层面做好i18n准备,react-i18next

### 第五轮: 深度技术探索
- [x] 文件存储方案: Apache Arrow + DuckDB-WASM浏览器端数据库可行性分析
- [x] 飞书多维表格Rust引擎: 确认使用Rust公式运算引擎+内存视图引擎+MPP
- [x] 自动保存机制: 三层策略(内存→本地Debounce→服务端异步TransactionQueue)
- [x] Local-First架构: DuckDB-WASM + IndexedDB/OPFS + CRDT同步的可行性
- [x] CRDT vs OT 深度研究: 评估从OT切换到CRDT(Yjs+Yrs)的可行性，建议切换

### 第六轮: CRDT 实施层深度研究
- [x] Yrs CRDT 能力验证: 200K行+200列性能基准测试，GC策略分析
- [x] 公式引擎深度调研: Formualizer/IronCalc/CALC 对比，Formualizer 推荐
- [x] CRDT 中公式处理方案: 公式定义存 CRDT(LWW)，结果不存，事件驱动响应式计算
- [x] 跨表关联在 CRDT 中的实现: 应用层存储关联记录 ID，参考 AppFlowy/Notion 模式
- [x] AppFlowy 架构详细分析: 客户端 SQLite + 服务端 PostgreSQL + S3，AppFlowy-Collab 设计
- [x] SQLite WAL 性能基准: 约 3351 写入/s，p99 <6ms，CRDT 场景足够
- [x] Loro CRDT vs Yrs 深度对比: Map 操作快 65x，原生 MovableList/Shallow Snapshot/DAG
- [x] 大文档分片策略: 按 table_id 分片+快照压缩+LRU 热表缓存
- [x] Loro + PostgreSQL + S3 架构可行性: loro-extended PG 适配器已验证，Rust 集成方案
- [x] 架构决策更新: 决策三 — CRDT Yrs→Loro，存储 SQLite→PostgreSQL+S3

## 已形成结论的技术决策

> **重要**: 以下决策经过多轮深度技术调研后于 2026-04-24 更新。最新变更（决策三）：CRDT 从 Yrs 改为 Loro，存储从 SQLite 改为 PostgreSQL + S3。详见 `tech-architecture/architecture-decision-2026-04.md`。

| 决策领域 | 结论 | 依据 |
|---------|------|------|
| 数据存储 | **Loro CRDT + PostgreSQL + S3** | Loro 是数据 source of truth，PG 存快照/操作日志/关系型元数据，S3 存附件；服务端 PG 生产验证优于 SQLite |
| 实时协作 | **Loro CRDT** | Map 操作比 Yjs 快 65x，原生 MovableList 支持行列拖拽，Shallow Snapshot 内存优化，Eg-walker 算法 |
| 公式引擎 | Formualizer (Rust+WASM) | MIT/Apache-2.0许可，320+公式；前端 WASM + 后端原生 Rust 直调 |
| 前端技术 | React + Next.js + loro-extended/react | 生态丰富，Canvas 自研表格渲染，loro-extended 提供 useDocument/useValue/usePresence Hooks |
| **后端技术** | **纯 Rust (Axum)** | 统一语言（协作+API+公式），单二进制部署，消除 TS/Rust 双栈维护成本 |
| 搜索 | **PG tsvector + pg_jieba** | PostgreSQL 原生全文搜索，pg_jieba 中文分词，后续可加 Meilisearch |
| 版本控制 | **Loro Git-like DAG** | 内建版本 DAG，Shallow Snapshot 压缩旧历史，无需自建快照轮转 |
| 自动化 | Trigger→Action 事件驱动 | 比轮询实时性好 |
| 权限 | **PG RLS + 应用层 RBAC** | PostgreSQL 行级安全策略 + Axum 中间件双层权限 |
| 部署 | **Docker Compose (Axum + PG + MinIO)** | 一键部署，PG 提供成熟运维工具链 |
| 扩展 | PG 读写分离 → Citus 水平扩展 | PostgreSQL 生态成熟，按需横向扩展 |
| API | RESTful + WebSocket | REST 业务 API + WebSocket Loro 同步 |
| UI组件 | Ant Design | 200+组件,企业级；表格自研 Canvas |
| 测试 | Vitest + Playwright | 金字塔策略 |
| 监控 | OTel + Prometheus + Grafana | 分阶段引入 |
| AI | 云端 LLM API 起步 | 后期可本地部署 |
| 国际化 | react-i18next | 初期中文 |

## 全部研究方向已完成 ✓
所有计划内方向均已覆盖。后续可按需深入:
- 安全审计(OWASP)专项
- 无障碍(a11y)设计
- Chinese full-text search with pg_jieba 具体实现方案
- Canvas + Loro 数据绑定 PoC
- 多租户 PostgreSQL 隔离策略
- Loro + Axum WebSocket 集成实现细节

## 核心架构总览
```
┌────────────── 前端 ──────────────┐
│  React + Next.js                 │
│  Canvas表格渲染 / 虚拟滚动        │
│  Formualizer公式引擎(WASM)        │
│  loro-crdt + loro-extended/react  │
├────────────── 后端 ──────────────┤
│  Rust (Axum) — 统一后端          │
│  ├── REST API（业务逻辑）         │
│  ├── WebSocket（Loro CRDT同步）   │
│  ├── Formualizer（原生Rust）      │
│  ├── 自动化工作流引擎             │
│  └── Webhook推送                  │
├────────────── 数据层 ─────────────┤
│  PostgreSQL（主存储）             │
│  ├── 关系表：users/spaces/        │
│  │   permissions/automations      │
│  ├── CRDT快照/操作日志(BYTEA)     │
│  └── PG tsvector + pg_jieba 全文搜索│
│  MinIO / S3（文件/附件存储）      │
│  热表CRDT状态：进程内存(LRU缓存)   │
├────────────── 可选扩展 ───────────┤
│  Redis（多实例/队列/广播时引入）   │
│  Meilisearch（搜索增强）          │
│  Citus（PG水平扩展）              │
└──────────────────────────────────┘
```

## 文件索引
```
multi-table-research/
├── notes.md                                    # 本文件(研究笔记)
├── references.md                               # 参考链接汇总
│
├── product-design/
│   ├── view-system-design.md                   # 视图系统设计(6种视图)
│   ├── permission-model.md                     # 权限模型设计
│   ├── automation-workflow.md                  # 自动化工作流引擎
│   ├── plugin-extension-system.md              # 插件/扩展系统
│   ├── mobile-adaptation.md                    # 移动端适配方案
│   ├── ai-integration.md                       # AI能力集成
│   ├── filter-system.md                        # 数据筛选系统设计
│   ├── field-type-system.md                    # 字段类型系统(含自定义字段)
│   ├── template-system-design.md               # 模板体系设计(产品对比)
│   └── scenario-templates.md                   # 场景化模板设计(6大场景)
│
├── tech-architecture/
│   ├── notion-architecture.md                  # Notion架构概览
│   ├── notion-block-model-detail.md            # Notion Block模型详解
│   ├── feishu-bitable-architecture.md          # 飞书多维表格架构
│   ├── crdt-realtime-collaboration.md          # CRDT实时协作方案
│   ├── univer-spreadsheet-engine.md            # Univer表格引擎
│   ├── formula-engine.md                       # 公式引擎方案
│   ├── frontend-performance.md                 # 前端性能优化
│   ├── import-export.md                        # 导入导出方案
│   ├── search-engine.md                        # 搜索引擎方案(概览)
│   ├── search-engine-detail.md                 # 搜索引擎实现深度研究(中文全文搜索/Meilisearch/索引同步/分面搜索/跨表搜索/API设计)
│   ├── version-control-undo-redo.md            # 版本控制与撤销重做
│   ├── webhook-event-system.md                 # Webhook与事件系统
│   ├── tech-stack-selection.md                 # 技术选型方案
│   ├── deployment-scaling.md                   # 部署方案与数据库扩展
│   ├── api-design.md                           # API设计(RESTful+WebSocket)
│   ├── design-system-selection.md              # 前端组件库选型
│   ├── testing-strategy.md                     # 测试策略
│   ├── observability-monitoring.md             # 监控与可观测性
│   ├── i18n.md                                 # 国际化方案
│   ├── ot-implementation-detail.md             # OT算法实现详解(Transform函数/APITable源码分析/光标协议/WebSocket协议/离线编辑/服务端架构)
│   ├── canvas-rendering-detail.md              # Canvas渲染引擎深度研究(APITable Konva源码/渲染管线/编辑器覆盖层/虚拟滚动/命中测试)
│   ├── auth-security-detail.md                 # 认证授权与安全设计(JWT/RLS/OWASP/加密/审计日志/分享安全)
│   ├── automation-engine-detail.md             # 自动化引擎实现(n8n架构/BullMQ调度/错误重试/脚本沙箱/Temporal对比)
│   ├── rust-engine-autosave.md                # 飞书Rust引擎 & 自动保存机制
│   └── rust-ecosystem-research.md             # Rust生态系统调研(JSONB/OT/CRDT/WASM公式引擎/Web框架深度对比/Axum vs Actix vs Rocket vs Warp/NestJS对比)
│   └── crdt-vs-ot-deep-research.md            # CRDT vs OT深度研究(结构化数据对比/Yjs-Yrs表格模型/Figma-AppFlowy案例/冲突解决/Rust集成/迁移路径/最终建议)
│   └── rust-formula-engine-research.md       # Rust公式引擎深度调研(Formualizer/IronCalc/WASM可行性/HyperFormula许可证更正)
│   └── architecture-decision-2026-04.md     # 架构决策记录(纯Rust后端+CRDT原生+SQLite方案)
│   └── crdt-sqlite-deep-research.md        # CRDT+SQLite深度调研(Yrs能力/公式处理/跨表关联/AppFlowy架构/SQLite WAL性能)
│   └── loro-postgresql-architecture-research.md # Loro+PostgreSQL+S3架构方案调研(Loro评估/loro-extended生态/PG Schema/对比分析)
│
├── data-storage/
│   ├── data-model-design.md                    # 数据模型设计(深度分析)
│   ├── apitable-snapshot-data-structure.md     # APITable Snapshot数据结构
│   ├── database-schema-detail.md               # 数据库Schema完整性(用户表/分区/乐观锁/迁移/索引生命周期/关联字段)
│   └── file-based-arrow-storage.md             # 文件存储方案 & Apache Arrow/DuckDB-WASM技术路线
│
└── open-source-projects/
    ├── open-source-comparison.md               # 开源项目对比
    ├── apitable-detail.md                      # APITable详解
    └── competitive-deep-analysis.md            # 竞品深度技术分析(Notion/飞书/APITable横向对比)
```
