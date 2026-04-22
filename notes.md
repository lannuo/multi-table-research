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
- [x] 公式引擎: HyperFormula(推荐)
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

## 已形成结论的技术决策

| 决策领域 | 结论 | 依据 |
|---------|------|------|
| 数据模型 | PostgreSQL + JSONB 分层架构 | 用户自定义字段 + 分析需求平衡 |
| 实时协作 | OT(参考APITable) | 成熟方案，APITable已验证 |
| 公式引擎 | HyperFormula | MIT许可，400+公式 |
| 前端技术 | React + Next.js | APITable同方案，生态丰富 |
| 后端技术 | NestJS (TypeScript) | 前后端统一语言，结构化强 |
| 搜索 | PG原生→Meilisearch分阶段 | stringify字段+GIN索引起步 |
| 版本控制 | Changeset + Snapshot | APITable方案 |
| 自动化 | Trigger→Action事件驱动 | 比轮询实时性好 |
| 权限 | PostgreSQL RLS + RBAC | 行列级安全 |
| 部署 | 私有化Docker起步 | 公司内部使用优先 |
| 扩展 | Citus + OLAP按需引入 | 按数据量级渐进 |
| API | RESTful + WebSocket | APITable/Notion方案 |
| UI组件 | Ant Design | 200+组件,企业级 |
| 测试 | Vitest + Playwright | 金字塔策略 |
| 监控 | OTel + Prometheus + Grafana | 分阶段引入 |
| AI | 云端LLM API起步 | 后期可本地部署 |
| 国际化 | react-i18next | 初期中文 |

## 全部研究方向已完成 ✓
所有计划内方向均已覆盖。后续可按需深入:
- 具体的数据库Schema DDL设计
- 前端Canvas渲染引擎的详细实现
- OT算法的具体Transform函数设计
- 安全审计(OWASP)专项
- 无障碍(a11y)设计

## 核心架构总览
```
┌──────────── 前端 ────────────┐
│  React + Next.js             │
│  Canvas表格渲染 / 虚拟滚动    │
│  HyperFormula公式引擎         │
│  OT客户端                     │
├──────────── API层 ───────────┤
│  NestJS (TypeScript)         │
│  OT服务器 / WebSocket        │
│  自动化工作流引擎             │
│  Webhook推送                  │
├──────────── 数据层 ───────────┤
│  PostgreSQL (JSONB)          │
│  ├── 元数据 (tables/fields)  │
│  ├── 记录 (records+data)     │
│  ├── 协作 (changesets)       │
│  └── 分区 / Citus扩展        │
│  Redis (缓存+队列)           │
├──────────── 可选扩展 ─────────┤
│  Meilisearch (全文搜索)       │
│  ClickHouse (OLAP分析)       │
│  MinIO (文件存储)             │
└──────────────────────────────┘
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
│   ├── search-engine.md                        # 搜索引擎方案
│   ├── version-control-undo-redo.md            # 版本控制与撤销重做
│   ├── webhook-event-system.md                 # Webhook与事件系统
│   ├── tech-stack-selection.md                 # 技术选型方案
│   ├── deployment-scaling.md                   # 部署方案与数据库扩展
│   ├── api-design.md                           # API设计(RESTful+WebSocket)
│   ├── design-system-selection.md              # 前端组件库选型
│   ├── testing-strategy.md                     # 测试策略
│   ├── observability-monitoring.md             # 监控与可观测性
│   └── i18n.md                                 # 国际化方案
│
├── data-storage/
│   ├── data-model-design.md                    # 数据模型设计(深度分析)
│   └── apitable-snapshot-data-structure.md     # APITable Snapshot数据结构
│
└── open-source-projects/
    ├── open-source-comparison.md               # 开源项目对比
    └── apitable-detail.md                      # APITable详解
```
