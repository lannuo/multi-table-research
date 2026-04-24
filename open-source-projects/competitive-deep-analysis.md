# 多维表格竞品深度技术分析

> 对 Notion、飞书多维表格、APITable 三大竞品进行技术架构深入分析，包含横向技术对比。

## 一、Notion 深度技术架构

### 1.1 核心数据模型：Block 图状结构

**一切皆 Block**，这是 Notion 架构的基石。

#### Block 存储实现
- **底层数据库**：PostgreSQL（最初单台 RDS 最大实例，后水平分片）
- **核心表结构**：
  - `blocks` 表：存储所有 Block（页面、段落、数据库行等）
  - 每条 Block 包含：`id`, `type`, `parent_id`, `content` (JSONB), `properties` (JSONB)
  - Block 之间的引用关系通过 `parent_id` 构建父子层级树
  - 数据库（Collection）本身也是一个 Block
  - 数据库的每一行同样是 Block，可包含任意内容（wiki/notes 页面）
- **关系模型**：形成有向无环图（DAG），Block 之间通过引用构成图结构
- **JSONB 字段**：`properties` 存储类型特有数据（如文本内容、日期值、选单选项等）

#### Database as Block
- 数据库（Collection）= Block + Schema 定义
- 数据库行 = Block + 类型化属性（typed properties）
- 视图 = 同一底层数据的投影（不同筛选/排序/分组配置）
- 一套数据、多种视图：表格、看板、日历、画廊等只是投影方式不同

#### 版本控制
- **Operation Log + Snapshot** 模式
- 所有变更记录为 Operation 流
- 定期拍摄 Snapshot（点-in-time 状态快照）
- 恢复版本时：找到最近 Snapshot + 重放 Operations
- 公式：`T_reconstruct = T_snapshot_load + N_ops × T_per_op`

> 来源：Notion 官方博客 "The Data Model Behind Notion's Flexibility"、Educative.io 系统设计分析

### 1.2 实时协作引擎

#### 协议与算法
- **方案**：基于 Operation 的同步，支持 OT（Operational Transformation）或 CRDT
- **冲突解决**：Operation-Based Sync，操作带因果关系
- **三阶段同步流程**：
  1. **Local Apply**：客户端立即应用到本地 Block 状态并渲染
  2. **Server Push**：发送操作到协作引擎，服务端分配全局顺序并持久化
  3. **Remote Broadcast**：服务端转发操作到所有其他客户端

#### 离线编辑支持
- **Offline-First** 架构
- 客户端本地存储（浏览器 IndexedDB，移动端 SQLite）作为主要写入目标
- 断网时操作队列在本地增长，恢复连接后批量同步
- 重连时发送版本向量（version vector），服务端计算缺失的 Operations 增量同步
- Delta Synchronization：只传输差异，避免全量状态传输

#### 连接管理
- WebSocket 长连接
- 按页面范围订阅变更流，减少不必要的数据传输
- 协作服务器按活跃页面分区，每个页面的实时会话由单台服务器处理

### 1.3 前端架构

#### 渲染方案
- **React + 自定义渲染引擎**
- Block 编辑器基于 React 组件树
- 大页面采用增量加载（viewport-sized batches）
- Lazy loading 低于 fold 的 Block
- 虚拟化渲染树避免同时渲染数千个 Block

#### 缓存策略
- **服务端多层缓存**：
  - 热页面缓存：活跃编辑的页面保存在协作服务器内存
  - Block 元数据缓存：Redis/Memcached 分布式缓存
  - 权限缓存：已解析 ACL 缓存在每个页面
- **客户端缓存**：
  - 本地 Block Store（IndexedDB/SQLite）镜像服务端状态
  - 滚动时分页加载 + 视口外预取
  - Undo/Redo 完全在本地操作栈上操作，无需服务端往返

### 1.4 扩展性与性能

#### 数据库分片（Space Sharding）
- **按 Workspace ID 分片**
- 演进历程：
  - 早期：单台 PostgreSQL (AWS RDS)
  - 第一次扩展：水平分片为 32 台
  - 第二次扩展（2023年）：从 32 台扩展到 **96 台**
- 分片细节：
  - 每个数据库 15 个逻辑 schema
  - 3x 扩展后每 shard 5 个 schema
  - PgBouncer 连接池代理层
  - PgBouncer 本身也分片为 4 组（每组 24 台下游数据库）
- **迁移方式**：PostgreSQL Logical Replication + 零停机切换
  - 新建 Publication（每个旧库 3 个，每个覆盖 5 个 schema）
  - 新库创建 Subscription 消费 Publication
  - 验证：Dark Read（并行读新库对比旧库结果，近 100% 等价）
  - 切换：暂停旧库 → 等待复制追上 → 更新 PgBouncer 配置 → 反向复制以支持回滚
  - 用户感知：最坏约 1 秒"saving"加载动画

#### 性能指标
- 数据 3 年增长 10 倍，每 6-12 个月翻倍
- 扩展后 CPU 和 IOPS 利用率从 90%+ 降至 ~20%
- 分片发现：负载分散后暴露超大 workspace 的异常 CPU 消耗

> 来源：Notion 工程博客 "The Great Re-shard: adding Postgres capacity (again) with zero downtime"

#### 搜索基础设施
- 从 PostgreSQL 全文搜索 → **Elasticsearch** 迁移
- 三组件架构：
  1. **索引管线**：异步监听 Operation Log / CDC，提取可搜索文本
  2. **搜索引擎**：Elasticsearch 评估全文查询，workspace 隔离
  3. **Freshness Reconciler**：后台修复索引漂移，编辑后 <5s 出现在搜索结果
- 索引按 workspace 分区，简化权限检查
- 排序：BM25 + 时效性 + 用户交互信号
- 增量更新 + 定期全量重建

### 1.5 AI 集成

- **Block 结构化数据优势**：每个段落/任务/数据库条目都是带元数据和关系的 Block
- AI 不只是关键词搜索，而是理解 workspace 结构和关系
- 模型路由：根据任务选择不同模型（速度/质量/成本权衡）
- 持续评估框架：新模型发布时自动评估和部署

> 来源：Notion 博客 "Speed, Structure, and Smarts: The Notion AI Way"

### 1.6 权限模型

- **继承 + 覆盖**模型：
  1. Workspace 定义默认权限
  2. 顶层页面继承 Workspace 权限（可覆盖）
  3. 子页面继承父页面权限（可覆盖）
  4. 特定 Block 可有独立访问规则
- **双层执行**：
  - API Gateway：请求到达前检查权限缓存
  - 协作引擎：实时操作广播前验证权限
- 权限变更通过事件驱动失效模型快速传播（秒级生效）
- 深层嵌套权限检查优化：缓存已解析的"有效 ACL"

---

## 二、飞书多维表格深度技术架构

### 2.1 产品演进与数据规模

#### 关键里程碑
| 时间 | 单表容量 | 备注 |
|------|---------|------|
| 早期 | 1 万行 | 基础多维表格 |
| 2024 年 | 20 万行 | 全面支持 |
| 2024 年 12 月 | 100 万行 | 试点百万热行 |
| 2025 年 7 月 | **1000 万热行** | 新一代多维表格数据库 |

#### 核心性能数据（2025 升级后）
- 单表 **1000 万热行**，毫秒级计算
- 万行复杂计算：**5 秒内**获取结果
- 仪表盘可统计 **1000 万行**数据
- 并发协作：**1000 人**同时在线编辑
- 月活用户即将突破 **1000 万**
- 仪表盘支持上亿行规模数据分析

> 来源：新浪财经 "飞书多维表格全面升级"（2025-07-14）

### 2.2 底层架构 — 8 大核心引擎

#### 整体架构
- **微服务 + 云原生设计**
- 核心数据存储：PostgreSQL（关系型，大量自定义扩展）+ Redis（缓存/加速）
- 字节跳动内部基础设施支持

#### 8 大核心引擎（2025 架构）

| # | 引擎名称 | 功能 |
|---|---------|------|
| 1 | **内存表格视图引擎** | 内存中高效视图计算和渲染 |
| 2 | **Rust 公式迅算引擎** | 毫秒级公式计算（10万行×100列 < 5s） |
| 3 | **智能算力调度引擎** | 动态分配计算资源，按需调度 |
| 4 | **MPP 大规模并行处理引擎** | 千万行级别分布式计算 |
| 5 | **时间机器（Time Machine）** | 多版本存储（类似 MVCC），支持历史回溯 |
| 6 | **向量一体化存储引擎** | 单次存储完成结构化+向量化处理 |
| 7 | **行列混合分析引擎** | 行式+列式混合分析，OLAP 能力 |
| 8 | **Hyper Sync 同步引擎** | 1000 人并发协作实时同步 |

#### 多维表格数据库（核心升级）
- 从"工具"到"平台"的跨越
- **热行概念**：每行承载动态计算值（公式、引用、跨表计算），区别于静态数据行
- **向量一体化存储**：数据单次存储即可同步完成结构化和向量化处理
  - 同时支持结构化查询与向量检索
  - 为 AI 应用（RAG）提供数据底座

#### 数据分层存储
- 分库分表
- 冷热分离
- 活跃数据放入高速存储
- 游标分页（cursor-based pagination）

### 2.3 Rust 公式迅算引擎

- **Rust "超维计算引擎"**（Hyper-dimensional Computing Engine）
- 服务端运行，多核并发处理
- 性能飞跃：万行复杂计算从 1-2 分钟 → **毫秒级**
- 配合 MPP 引擎支持千万行级别聚合/筛选/分组
- WASM 编译能力支持前端高性能计算
- 字节跳动在 Rust 生态深度积累（TiKV、RustRPC 等内部基础设施）

### 2.4 前端渲染引擎

#### 自研 Canvas 渲染引擎
- **Flutter 风格的 Widget 系统**：自研 Widget 树管理渲染
- **虚拟列表 Widget**：支持嵌套虚拟化（虚拟列表中的虚拟列表）
- **脏矩形渲染**（Dirty Rectangle Rendering）：只重绘变化的区域
- **异步批量绘制**：合并渲染指令，减少 Canvas 绘制次数
- **FVG（Frame Virtual Graph）**：类似 Flutter 的 hydrate 机制，支持服务端渲染
- **R-tree 事件系统**：基于几何方法（非基于颜色）的命中测试，高效事件分发

#### 性能优化
- 前后端协同的**分页加载**（游标分页）
- 后端**预聚合 + 缓存**设计
- 内置公式计算性能诊断功能
- 10 万行 × 100 列公式计算 < 5 秒

### 2.5 Hyper Sync 协作引擎

- **Hyper Sync 算法**（2025 新增）：支持 **1000 人**同时在线编辑
- WebSocket 实时通信
- 可能融合了 OT/CRDT 的混合方案
- 毫秒级操作同步

> 来源：CSDN/网易对飞书多维表格负责人施凯文的采访（2024年9月）、InfoQ 技术文章

### 2.6 AI 能力集成

#### AI 全家桶（2025 版本）
1. **AI 字段捷径**：AI 能力嵌入每个单元格，像公式一样调用
2. **AI 节点捷径**：工作流节点自由编排 AI 能力
3. **AI 生成工作流**：自然语言描述 → 自动分解为节点
4. **AI Agent 节点**：主动思考和决策的 AI 代理
5. **AI 分类节点**：智能数据分类
6. **AI 侧边栏**：数据检索、知识问答、数据分析、工具调用

#### DeepSeek 集成
- 支持多种大模型接入
- AI 工作流可视化搭建

### 2.6 工作流引擎

- 从简单自动化 → **可视化流程画布**
- 支持**循环和条件判断**
- 全新的流程设计界面（画布式，非分区式）
- 实战案例：一条工作流串联 100 家门店每日 5000+ 项任务

### 2.7 权限系统

- **高级权限**：数据表、视图、行、列的读写权限独立设置
- 可面向**个人、群聊、用户组、部门**分别配置
- **条件权限**：根据特定条件自动调整权限
- 功能使用权限管控（如谁能配置自动化节点）

### 2.8 仪表盘（BI 能力）

- 数据透视表 + 切片器
- 图表联动、TopN 分析、行列转置、上卷下钻
- 专业级图表：气泡图、地图、桑基图
- BI 主题模板
- 每个图表可对 **1000 万行**、来自最多 **200 张表**的数据实时统计

---

## 三、APITable 源码级架构分析

### 3.1 项目整体结构

#### Monorepo 组织
```
apitable/
├── packages/
│   ├── sdk/                    # 核心 SDK
│   ├── grid/                   # Canvas 渲染引擎（独立包）
│   ├── formula-engine/         # 公式引擎
│   ├── widget-sdk/             # Widget 开发 SDK
│   ├── icons/                  # 图标库
│   ├── design-system/          # 设计系统组件
│   └── ...
├── apps/
│   ├── nextjs/                 # 前端 Next.js 应用
│   ├── nestjs-backend/         # 后端 NestJS 服务
│   ├── nestjs-trigger-server/  # 自动化触发服务器
│   └── ...
├── server/                     # Java Spring Boot 服务
├── .github/
├── docs/
└── docker-compose.yml
```

#### 技术栈
- **前端**：TypeScript + Next.js + React
- **后端**：TypeScript (NestJS) + Java (Spring Boot)
- **数据库**：PostgreSQL
- **缓存**：Redis
- **渲染**：Canvas（自研渲染引擎）
- **实时协作**：OT 算法
- **许可证**：AGPL-3.0

### 3.2 数据模型深度分析

#### 四层核心概念

```
Snapshot → Changeset → Operation → Action
```

1. **Snapshot（快照）**
   - 某个时刻数据表的完整状态
   - 包含所有字段定义、视图配置、记录数据
   - 定期生成，用于加速页面加载和版本回溯

2. **Changeset（变更集）**
   - 一组相关操作的集合
   - 代表一次用户交互产生的完整变更
   - 与 Snapshot 配合实现版本控制

3. **Operation（操作）**
   - 单个原子操作（如修改单元格值、添加行、修改字段等）
   - 可通过 OT 算法进行 Transform

4. **Action（动作）**
   - 对 Operation 的进一步封装
   - 包含操作的上下文信息（谁、何时、哪个表）

#### 数据库 Schema 设计
- **PostgreSQL** 关系型存储
- 主要表结构：
  - `datasheet` / `dst_snapshot`：数据表快照
  - `dst_changeset`：变更集记录
  - `field`：字段定义（类型、属性等）
  - `view`：视图配置
  - `unit_id` → 对应记录数据
- 字段值存储方式：JSONB 存储动态字段数据

#### Space 架构
- 使用 **Space（空间）** 替代 App/Base 结构
- 一个 Space 内所有表可无限关联
- Space 层级：Team → Space → Node（文件/数据表）

### 3.3 OT 实现细节

#### OT 算法核心
- **Server-centric OT**：服务端负责操作排序和冲突解决
- Transform 函数处理并发操作：
  - 客户端发送 Operation 到服务端
  - 服务端检查是否有冲突的已提交 Operation
  - 如有冲突，调用 Transform 函数调整
  - 服务端分配全局 revision 号
  - 广播调整后的 Operation 到所有客户端

#### 服务端 OT 处理流程
1. 接收客户端 Operation
2. 与当前 revision 对比
3. 如 client_rev < server_rev，重放所有 client_rev..server_rev 的 Operations 进行 Transform
4. 分配新 revision，持久化
5. 广播给其他客户端
6. ACK 给发送客户端

#### WebSocket 协议
- 消息格式：JSON
- 消息类型：Operation、ACK、Sync、Cursor、Presence 等
- 每个数据表维护独立的 WebSocket 连接/频道

### 3.4 Canvas 渲染引擎

#### 技术选型
- 基于 **Konva.js**（2D Canvas 库）
- 自研在 Konva 之上的表格渲染层

#### 渲染管线
```
数据变更 → 计算 Diff → 生成渲染指令 → Canvas 绘制
```

#### 核心组件
1. **Grid 层**：Canvas 绘制表格网格线、单元格内容
2. **Overlay 层**：HTML 覆盖层，处理单元格编辑（input/textarea/datepicker 等）
3. **Selection 层**：选区高亮、拖拽手柄

#### 性能优化
- **虚拟滚动**：只渲染可视区域的单元格
- **增量渲染**：数据变更时只重绘受影响的单元格
- **命中测试（Hit Testing）**：将 Canvas 坐标映射到单元格位置
- **分层 Canvas**：背景层（静态网格）+ 内容层（动态数据）

#### 单元格编辑
- 双击单元格时，在 Canvas 上方显示 HTML overlay
- overlay 定位精确匹配单元格 Canvas 位置
- 编辑完成后移除 overlay，更新 Canvas 渲染

### 3.5 API 设计

#### RESTful API
- `/api/v1/spaces/{spaceId}/datasheets/{datasheetId}/records` — 记录 CRUD
- `/api/v1/spaces/{spaceId}/datasheets/{datasheetId}/fields` — 字段管理
- `/api/v1/spaces/{spaceId}/datasheets/{datasheetId}/views` — 视图管理
- 支持 API Panel（一键查看 API 文档）

#### 认证
- Bearer Token 认证
- Personal Access Token / OAuth 2.0

### 3.6 Widget/Plugin 系统

#### 架构
- **iframe 沙箱**隔离每个 Widget
- 通信机制：`postMessage` 双向通信
- Widget SDK 提供：
  - 数据读取 API
  - 主题适配 API
  - 容器尺寸感知 API
- 20+ 官方开源 Widget

### 3.7 自动化/机器人系统

- Trigger → Condition → Action 模型
- 支持触发器：数据变更、定时触发、Webhook
- 支持动作：发送通知、更新记录、调用 Webhook
- 集成：n8n.io、Zapier、Appsmith

---

## 四、横向技术对比

### 4.1 数据模型对比

| 维度 | Notion | 飞书多维表格 | APITable |
|------|--------|------------|----------|
| **核心模型** | Block 图状结构 | 表格为中心 + 关系 | 表格为中心 |
| **统一性** | 极高（一切皆Block） | 中等（表格+文档分离） | 低（纯表格） |
| **存储方式** | PostgreSQL（Block表+JSONB） | PostgreSQL + 自研引擎 | PostgreSQL（Snapshot+Changeset） |
| **数据库行** | = Block（可包含完整页面） | = 记录（结构化数据） | = 记录（JSONB 动态字段） |
| **版本控制** | Operation Log + Snapshot | 未公开 | Changeset + Snapshot |
| **最大行数** | 未公开（理论数十万） | **1000 万热行** | 10 万+ |

### 4.2 实时协作对比

| 维度 | Notion | 飞书多维表格 | APITable |
|------|--------|------------|----------|
| **协作算法** | OT/CRDT 混合 | 未公开（推测OT） | OT（Server-centric） |
| **离线支持** | Offline-First（IndexedDB/SQLite） | 有限 | 基本的自动保存 |
| **并发人数** | 未公开 | **1000 人** | 数十人 |
| **WebSocket** | 按页面订阅变更流 | 支持 | 按数据表频道 |
| **冲突解决** | Operation-based | 未公开 | Transform 函数 |
| **同步粒度** | Block 级别 | 单元格级别 | 单元格级别 |

### 4.3 渲染引擎对比

| 维度 | Notion | 飞书多维表格 | APITable |
|------|--------|------------|----------|
| **前端框架** | React | 未公开（推测React） | React + Next.js |
| **渲染方式** | React 组件树（DOM） | 增量渲染 | **Canvas（Konva.js）** |
| **虚拟滚动** | Block 级别虚拟化 | 支持 | Canvas 级别虚拟化 |
| **编辑方式** | ContentEditable | HTML overlay | Canvas + HTML overlay |
| **大数据量** | Lazy loading Block | 千万行分页加载 | 10 万+ 行流畅 |
| **性能特点** | 文档编辑优秀 | 数据处理强 | 表格交互极度流畅 |

### 4.4 公式引擎对比

| 维度 | Notion | 飞书多维表格 | APITable |
|------|--------|------------|----------|
| **实现语言** | 未公开 | **Rust** | TypeScript |
| **公式数量** | 中等 | 丰富 | 丰富 |
| **计算性能** | 中等 | **毫秒级**（Rust引擎） | 一般 |
| **跨表引用** | 支持（Rollup） | 支持（跨表引用） | 支持（无限跨表链接） |
| **WASM 支持** | 否 | 是（Rust→WASM） | 否 |

### 4.5 权限模型对比

| 维度 | Notion | 飞书多维表格 | APITable |
|------|--------|------------|----------|
| **模型** | 继承+覆盖 | 细粒度RBAC | Mirror + 列权限 |
| **行级权限** | 页面级（Block继承） | **支持**（行级） | Mirror 视图 |
| **列级权限** | 属性级 | **支持**（列级） | **支持** |
| **条件权限** | 否 | **支持** | 否 |
| **功能权限** | 否 | **支持**（自动化节点等） | 否 |
| **传播速度** | 秒级 | 秒级 | 秒级 |

### 4.6 扩展性对比

| 维度 | Notion | 飞书多维表格 | APITable |
|------|--------|------------|----------|
| **分片策略** | Workspace ID（32→96 shards） | 数据分片+冷热分离 | 无内置分片 |
| **数据库** | PostgreSQL + PgBouncer | PostgreSQL + 自研引擎 | PostgreSQL |
| **搜索** | **Elasticsearch** | 未公开 | PG 全文搜索 |
| **缓存** | Redis + 多层内存缓存 | Redis | Redis |
| **Data Lake** | 有（数据湖） | 未公开 | 无 |
| **OLAP** | 有 | 仪表盘BI能力 | BI Dashboard |
| **最大规模** | 数十亿 Block | 千万行/表 | 10万+ 行/表 |

### 4.7 AI 能力对比

| 维度 | Notion | 飞书多维表格 | APITable |
|------|--------|------------|----------|
| **AI 集成深度** | **深**（Block结构化优势） | **深**（全流程AI） | 浅（ChatGPT企业版） |
| **AI 字段** | 否 | **AI字段捷径** | 否 |
| **AI 工作流** | 否 | **AI生成工作流+Agent节点** | 否 |
| **自然语言查询** | 支持 | 支持 | 否 |
| **模型选择** | 多模型路由 | DeepSeek+多模型 | ChatGPT |
| **向量存储** | 未公开 | **向量一体化存储** | 无 |

### 4.8 生态系统对比

| 维度 | Notion | 飞书多维表格 | APITable |
|------|--------|------------|----------|
| **插件系统** | API集成（无原生插件） | 应用模式 | **Widget SDK**（iframe沙箱） |
| **自动化** | 简单按钮自动化 | **可视化流程画布** | Robot 自动化 |
| **第三方集成** | 丰富（Slack/GitHub等） | 飞书生态深度集成 | n8n/Zapier/Appsmith |
| **API 开放性** | REST API | REST API | **API Panel**（可视文档） |
| **开源** | 否 | 否 | **是（AGPL-3.0）** |
| **移动端** | 原生 iOS/Android | 飞书 App 内嵌 | Web（响应式） |

---

## 五、对我们项目的启示

### 5.1 数据模型选择
- **Notion 的 Block 模型**灵活但复杂，适合文档+表格混合场景
- **APITable 的 Snapshot+Changeset** 适合纯表格场景，已验证可行
- **我们的选择**：APITable 方案 + JSONB，后续可参考 Notion 的 Operation Log 模式

### 5.2 协作方案
- Notion 的 Offline-First 值得学习
- APITable 的 OT 方案有成熟实现可参考
- **我们的选择**：CRDT（Yjs+Yrs），比 OT 更适合离线场景和 Rust 后端

### 5.3 性能目标
- 飞书千万行级别暂非首要目标
- APITable 10 万+ 级别是合理的初始目标
- **分阶段提升**：10万行 → 100万行 → 1000万行

### 5.4 渲染方案
- APITable 的 Canvas 方案在表格场景下性能最优
- Notion 的 DOM 方案更适合文档场景
- **我们的选择**：Canvas 渲染引擎（参考 APITable 的 Konva 方案）

### 5.5 AI 集成
- Notion 的 Block 结构化 + AI 是差异化优势
- 飞书的 AI 全流程集成是当前最前沿
- **我们应关注**：AI 字段、AI 工作流节点、向量一体化存储

### 5.6 公式引擎
- 飞书的 Rust 引擎是性能标杆
- **我们的选择**：Formualizer（Rust+WASM），与飞书方案一致

### 5.7 工作流引擎
- 飞书的可视化流程画布 + 循环/条件判断是标杆
- APITable 的简单 Trigger-Action 是基础方案
- **我们应追求**：飞书级别的可视化工作流能力

---

## 六、竞品功能完整度矩阵

| 功能 | Notion | 飞书 | APITable | 我们的目标 |
|------|--------|------|----------|-----------|
| 表格视图 | ★★★★ | ★★★★★ | ★★★★★ | ★★★★★ |
| 看板视图 | ★★★★ | ★★★★★ | ★★★★ | ★★★★ |
| 甘特视图 | ★★★ | ★★★★★ | ★★★★ | ★★★★ |
| 日历视图 | ★★★ | ★★★★ | ★★★★ | ★★★ |
| 画廊视图 | ★★★★ | ★★★★ | ★★★★ | ★★★ |
| 表单视图 | ★★★ | ★★★★★ | ★★★★ | ★★★★ |
| 思维导图 | ✗ | ★★★ | ★★★★ | ★★ |
| 实时协作 | ★★★★★ | ★★★★★ | ★★★★ | ★★★★ |
| 行级权限 | ★★★ | ★★★★★ | ★★★ | ★★★★ |
| 列级权限 | ★★★ | ★★★★★ | ★★★★ | ★★★★ |
| 自动化工作流 | ★★★ | ★★★★★ | ★★★ | ★★★★ |
| AI 集成 | ★★★★★ | ★★★★★ | ★★ | ★★★ |
| BI 仪表盘 | ★★ | ★★★★★ | ★★★ | ★★★ |
| 插件系统 | ★★ | ★★★ | ★★★★ | ★★★★ |
| 公式能力 | ★★★ | ★★★★★ | ★★★★ | ★★★★ |
| 导入/导出 | ★★★★ | ★★★★ | ★★★ | ★★★★ |
| API 开放性 | ★★★★★ | ★★★★ | ★★★★★ | ★★★★ |
| 移动端 | ★★★★ | ★★★★★ | ★★ | ★★★ |
| 搜索能力 | ★★★★★ | ★★★ | ★★ | ★★★ |

> 评分标准：★ 基础 → ★★★★★ 行业标杆

---

## 参考链接

### Notion
- [Notion 官方博客 - Data Model](https://www.notion.com/blog/data-model-behind-notion)
- [The Great Re-shard: adding Postgres capacity](https://www.notion.com/blog/the-great-re-shard)
- [Speed, Structure, and Smarts: The Notion AI Way](https://www.notion.com/blog/speed-structure-and-smarts-the-notion-ai-way)
- [Notion System Design - Educative.io](https://www.educative.io/blog/notion-system-design)
- [How Notion stores the data and scale](https://wildwildtech.substack.com/p/how-notion-stores-the-data-and-scale)
- [Notion Scaled to Handle Billions of Blocks](https://www.lorenzopalaia.com/blog/how-notion-scaled-to-handle-billions-of-blocks)

### 飞书多维表格
- [飞书多维表格全面升级 - 新浪财经](https://finance.sina.com.cn/jjxw/2025-07-14/doc-inffmpnp6568231.shtml)
- [即刻体验！五大多维表格新模块 - 飞书官网](https://www.feishu.cn/content/five-new-multidimensional-table-modules-feishu)
- [多维表格：数据分析的终极指南 - 飞书官网](https://www.feishu.cn/content/multidimensional-table-guide)
- [飞书多维表格公式计算优化指南](https://www.feishu.cn/hc/zh-CN/articles/022441339437)
- [Base data structure overview - 飞书开放平台](https://open.feishu.cn/document/uAjLw4CM/ukTMukTMukTM/bitable/development-guide/bitable-structure)

### APITable
- [APITable GitHub Repository](https://github.com/apitable/apitable)
- [APITable Developer Guide](https://apitable.github.io/docs/)
- [AITable Help Center](https://help.aitable.ai/)
- [APITable Widget SDK](https://github.com/apitable/widget-sdk)
