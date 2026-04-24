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

> **2026-04-24 最终更新**：经竞品深度调研（Teable/Baserow/NocoDB/Grist）、飞书架构深挖、Canvas PoC 验证、社区性能数据分析、以及四项决策分析（Make vs Buy / CRDT / 后端语言 / 公式引擎），得出以下结论。核心变更：后端从 Rust 回到 **NestJS (TypeScript)**，数据存储确定为 **PostgreSQL JSONB 混合模型**。详见 `tech-architecture/` 下的 4 个 decision-*.md。

| 决策领域 | 结论 | 依据 |
|---------|------|------|
| 数据存储 | **PostgreSQL JSONB 混合模型** | 核心字段物理列 + 动态字段 JSONB + GIN 索引；MVP 灵活迭代，百万行后物理化高频字段 |
| 实时协作 | **Loro CRDT** | Map 快 65x，原生 MovableList（行列拖拽），Shallow Snapshot（内存优化），Git-like DAG（版本历史），loro-extended 节省 2K+ 行胶水代码 |
| 公式引擎 | **Formualizer (Rust+WASM)** | MIT/Apache-2.0，320+ 公式，依赖图增量重算；v0.3 需接受早期风险 |
| 前端技术 | React + Next.js + Canvas 渲染 | Canvas PoC 已验证（60FPS@10万行, 10MB@20万行×100列）；loro-extended/react 提供 Hooks |
| **后端技术** | **NestJS (TypeScript)** | Solo 开发效率优先；Teable 验证了 NestJS+PG 可支撑商业级多维表格；公式引擎 WASM 前端计算解耦 |
| 搜索 | PG tsvector + pg_jieba | PostgreSQL 原生全文搜索，中文分词 |
| 版本控制 | Loro Git-like DAG | 内建，无需自建 |
| 自动化 | Trigger→Action 事件驱动 | NestJS + BullMQ |
| 权限 | 应用层 RBAC + PG RLS | 双层权限 |
| 部署 | Docker Compose (NestJS + PG + MinIO) | 3 容器，简单部署 |
| 扩展 | PG 读写分离 → Citus 水平扩展 | PostgreSQL 生态 |
| API | RESTful + WebSocket | REST 业务 API + WebSocket Loro 同步 |
| UI组件 | Ant Design | 200+组件；表格自研 Canvas |
| 测试 | Vitest + Playwright | 金字塔策略 |
| 监控 | OTel + Prometheus + Grafana | 分阶段引入 |
| AI | 云端 LLM API | 后期可本地部署 |
| 国际化 | react-i18next | 初期中文 |

## 核心架构总览

```
┌────────────── 前端 ────────────────────┐
│  React + Next.js                       │
│  Canvas 表格渲染 (PoC 已验证)           │
│  Formualizer 公式引擎 (WASM)            │
│  Loro CRDT + loro-extended/react        │
├────────────── 后端 ────────────────────┤
│  NestJS (TypeScript) — 统一后端         │
│  ├── REST API（用户/权限/元数据/文件）   │
│  ├── WebSocket（Loro CRDT 同步）        │
│  ├── BullMQ 任务队列                    │
│  └── 自动化工作流引擎                   │
├────────────── 数据层 ──────────────────┤
│  PostgreSQL（主存储）                   │
│  ├── 关系表 + JSONB 动态字段 (混合模型) │
│  ├── GIN 索引 (jsonb_path_ops)         │
│  └── PG tsvector + pg_jieba 全文搜索   │
│  MinIO / S3（文件/附件存储）            │
│  Redis（缓存 + 队列 + 会话）            │
└────────────────────────────────────────┘
```

## 补充研究
后续可按需深入:
- 安全审计(OWASP)专项
- 无障碍(a11y)设计
- pg_jieba 中文分词实测
- Canvas + Loro 数据绑定 PoC
- 多租户 PostgreSQL 隔离策略
- Formualizer 函数兼容性测试 (100 个高频公式)

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
│   └── mvp-scope-definition.md                 # MVP精确范围定义(V1目标/字段类型/视图/性能目标)
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
│   └── decision-review-critique.md           # 技术决策回顾审查(方法论问题/调研盲区/复合风险/流程建议)
│   ├── decision-make-vs-buy.md               # 决策分析: Fork开源 vs 从零构建
│   ├── decision-crdt-loro-vs-yjs.md          # 决策分析: CRDT选型 Loro vs Yjs
│   ├── decision-backend-language.md          # 决策分析: 后端语言 NestJS vs Rust
│   └── decision-formula-engine.md            # 决策分析: 公式引擎长期选型
│
├── data-storage/
│   ├── data-model-design.md                    # 数据模型设计(深度分析)
│   ├── apitable-snapshot-data-structure.md     # APITable Snapshot数据结构
│   ├── database-schema-detail.md               # 数据库Schema完整性(用户表/分区/乐观锁/迁移/索引生命周期/关联字段)
│   └── file-based-arrow-storage.md             # 文件存储方案 & Apache Arrow/DuckDB-WASM技术路线
│
├── poc/
│   ├── canvas-table-renderer/                 # PoC1: Canvas表格渲染(60FPS/10MB@20万行)
│   ├── postgres-jsonb-bench/                  # PoC2: JSONB vs 物理表方案分析
│   ├── formula-engine-bench/                  # PoC3: 公式引擎对比 (未实施)
│   └── crdt-minimal-sync/                     # PoC4: CRDT同步Demo (未实施)
│
└── open-source-projects/
    ├── open-source-comparison.md               # 开源项目对比
    ├── apitable-detail.md                      # APITable详解
    ├── competitive-deep-analysis.md            # 竞品深度技术分析(Notion/飞书/APITable横向对比)
    └── simple-architecture-analysis.md        # 竞品简单架构分析(Grist/NocoDB/Baserow/Teable)
```
