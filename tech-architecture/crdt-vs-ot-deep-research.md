# CRDT vs OT 深度研究：多维表格实时协作方案重新评估

> 调研日期: 2026-04
> 背景: 项目最初选择 OT（参考 APITable 方案），但 Rust 后端生态调研发现 Rust 几乎没有生产级 OT 库，而 Yrs（Yjs 的 Rust 移植）非常成熟。本报告系统评估 CRDT 替代 OT 的可行性。

---

## 一、研究背景与动机

### 1.1 当前决策

项目已确定实时协作采用 OT（Operational Transformation），参考 APITable 的实现架构：
- 前端：OT 客户端 + WebSocket
- 后端：NestJS (TypeScript) + OT 服务器
- 数据：Changeset + Snapshot 版本控制

### 1.2 重新评估的触发因素

| 因素 | OT 方案 | CRDT 方案 |
|------|---------|-----------|
| **Rust 生态** | 无成熟 OT 框架，需从头实现（预估 8000-12000 行 Rust） | Yrs 库非常成熟（MIT 许可，AppFlowy 生产验证） |
| **离线支持** | 天然弱，需要复杂的排队和重放机制 | 天然支持，Local-First 架构基础 |
| **服务端复杂度** | 需要中心化 Transform 引擎，状态管理复杂 | 服务端可作为简单中继，也可作为 CRDT Peer |
| **前沿趋势** | ShareDB 维护模式，新项目较少选择 | Yjs/Loro/Automerge 活跃发展，Notion/Figma 等采用 |

### 1.3 研究范围

本文聚焦于 **结构化表格数据**（非纯文本）场景下 OT 与 CRDT 的对比，覆盖：
- 表格操作（单元格编辑、行/列增删移动、排序筛选）
- 大数据量性能（100K+ 行）
- Rust 生态集成
- 生产案例与迁移路径

---

## 二、OT vs CRDT：结构化数据场景深度对比

### 2.1 文本 vs 表格：本质差异

绝大多数 OT/CRDT 文献以纯文本编辑为场景。多维表格的数据特征与文本有本质区别：

| 特征 | 纯文本 | 多维表格 |
|------|--------|----------|
| **数据结构** | 一维字符序列 | 二维网格 + 元数据（字段类型、视图配置） |
| **操作粒度** | 字符级（插入/删除） | 单元格级 + 行级 + 列级 + Schema 级 |
| **位置语义** | 顺序至关重要，交错不可接受 | 行的相对顺序不那么重要（除非排序），可接受交错 |
| **操作频率** | 高频连续输入（打字） | 低频离散操作（编辑单元格、增删行） |
| **并发模式** | 多人同位置插入 | 多人编辑不同单元格，偶尔同单元格 |
| **Schema 变更** | 无 | 有（添加/删除字段、修改类型），需与数据操作并发处理 |

### 2.2 OT 处理结构化数据的挑战

OT 的核心是 **Transform 函数**——为每对操作类型定义转换规则。结构化表格的操作类型远多于纯文本：

```
基本操作类型：
├── 单元格操作：SetCell(rowId, colId, value)
├── 行操作：InsertRow(index), DeleteRow(rowId), MoveRow(from, to)
├── 列操作：InsertCol(index), DeleteCol(colId), MoveCol(from, to), ResizeCol(colId, width)
├── Schema 操作：AddField(type, name), RemoveField(fieldId), ModifyFieldType(fieldId, newType)
├── 视图操作：Sort(fieldId, order), Filter(fieldId, condition), GroupBy(fieldId)
└── 批量操作：PasteCells(range, values), SortTable(fieldId, order)
```

Transform 函数的复杂度为 **O(N^2)**（N 为操作类型数）。APITable 的 OT 实现约 5000-8000 行 TypeScript，其中大部分是 Transform 函数。这意味着：

1. **新增操作类型成本高**：每增加一种操作，需与所有已有操作定义 Transform 对
2. **正确性验证困难**：操作组合呈指数级增长，形式化证明极其复杂
3. **Schema 变更与数据操作的交叉**：用户 A 添加字段的同时用户 B 编辑该列数据，Transform 处理复杂

### 2.3 CRDT 处理结构化数据的优势

CRDT 将冲突解决嵌入数据结构本身，而非依赖 Transform 函数。其核心思路：

1. **单元格 = LWW Register（Last-Writer-Wins 寄存器）**：每个单元格独立版本控制，不同单元格的编辑天然无冲突
2. **行/列位置 = Fractional Indexing（分数索引）**：使用 LSeq 或类似算法分配有序键，行/列插入无需全局重排
3. **Schema = CRDT Set**：字段集合使用 OR-Set（Observe-Remove Set），支持并发增删

关键论文支持：《A Study of Semantics for CRDT-based Collaborative Spreadsheets》（ACM 2023）专门研究了 CRDT 电子表格的语义问题。

### 2.4 综合对比表

| 维度 | OT | CRDT | 评分（表格场景） |
|------|-----|------|-----------------|
| **并发单元格编辑** | 需 Transform 处理同位置冲突 | LWW 自动解决，不同单元格无冲突 | CRDT 胜 |
| **行/列插入冲突** | Transform 处理索引偏移 | Fractional Indexing 自动定位 | CRDT 胜 |
| **Schema 变更并发** | 需大量 Transform 函数 | CRDT Set 自动合并 | CRDT 胜 |
| **排序/筛选操作** | 全局重排需复杂协调 | 视图状态作为 CRDT Map 同步 | 相当 |
| **意图保留** | Transform 可精细控制 | LWW 可能丢失意图（后写覆盖） | OT 胜 |
| **实现复杂度** | O(N^2) Transform 函数 | 数据结构设计 + 元数据管理 | CRDT 胜 |
| **服务端复杂度** | 需中心化 Transform 引擎 | 可简化为中继（也可作为 Peer） | CRDT 胜 |
| **离线支持** | 弱，需要排队机制 | 天然支持 | CRDT 胜 |
| **数据开销** | 操作日志较小 | 元数据开销较大（2x-3x 原始数据） | OT 胜 |
| **Rust 生态** | 无成熟库 | Yrs 非常成熟 | CRDT 胜 |

---

## 三、Yjs/Yrs 与表格数据

### 3.1 Yjs 核心共享类型与表格映射

Yjs 提供的共享类型可直接映射到表格数据结构：

| Yjs 共享类型 | 表格用途 | 说明 |
|-------------|---------|------|
| `YMap` | 行数据、字段元数据、视图配置 | 键值映射，支持并发修改不同键 |
| `YArray` | 行列表、列列表 | 有序序列，支持插入/删除/移动 |
| `YText` | 富文本单元格内容 | 支持字符级协作编辑 |
| `YDoc` | 整个表格文档 | 顶层容器 |

### 3.2 Yrs 的表格数据模型设计

Bartosz Sypytkowski（Yrs 作者）在 2024 年发表了专门的表格设计文章《Can Yrs fit my table?》，提出以下模型：

```
Table {
    cols: YArray<YMap>     // 列元数据（id, name, width, type...）
    rows: YArray<YMap>     // 行元数据（id, height...）
    cells: YMap            // 单元格数据，key = "{row_id}:{col_id}"
}
```

**关键设计决策**：

1. **单元格使用 YMap（而非 YArray of YArray）**：
   - 避免 `YArray of YArray` 的 `O(N^2)` 插入问题（每个 MapRef 在 Yrs 内部是独立 Block，200K 行的链表遍历极慢）
   - 使用 `"{row_id}:{col_id}"` 作为 key，直接定位单元格
   - 编辑不同单元格天然无冲突

2. **行/列使用 YArray of YMap**：
   - 支持并发增删和重排序
   - 列元数据（名称、宽度、类型）可并发修改不同属性

3. **性能实测**（200,000 行 x 9 列 = 1,800,000 单元格）：
   - 导入耗时：814ms
   - 编码耗时：100ms
   - 原始编码大小：55MB（原始 CSV 23MB，约 2.4x）
   - zstd 压缩后：11MB（约 0.5x），编码耗时增加至 400ms

### 3.3 大数据量性能分析

| 数据规模 | Yrs 测试结果 | 注意事项 |
|---------|-------------|---------|
| 10,000 行 | 毫秒级操作 | 完全可行 |
| 100,000 行 | 导入 <1s，日常操作流畅 | 需注意 YArray 的 `O(N^2)` prepend 问题 |
| 200,000 行 | 导入约 800ms | 编码后 2-3x 大小，压缩后 0.5x |
| 1,000,000+ 行 | 未有公开测试 | 需要分片或虚拟化策略 |

**关键优化**：
- **Prepend 策略**：批量插入行时使用 `insert(txn, 0, ...)` 头部插入（O(1)），而非尾部追加的 `O(N^2)` 遍历
- **预加载行数**：先统计总行数，再批量创建行元数据
- **列式序列化**：按列序列化数据，利用同列数据类型一致性进行压缩（布尔位图、枚举变长编码、时间戳增量编码）

### 3.4 Yjs 内存开销分析

Yjs/Yrs 的元数据开销是主要关注点：

| 组件 | 开销来源 | 优化手段 |
|------|---------|---------|
| Block 元数据 | 每个插入操作对应一个 Block（含 ID、origin、parent 指针） | Block Squashing：连续操作合并为一个 Block |
| 版本向量 | StateVector 用于增量同步 | 增量编码，仅传输差异 |
| 删除集 | DeleteSet 记录已删除元素 | 使用 (start, length) 对压缩，定期 GC |
| 单元格 key | `"{row_id}:{col_id}"` 字符串键 | 可用整数键或短哈希优化 |

**实测数据**：
- 生产环境大型 YDoc 约 40MB 内存
- 文本编辑场景，编码开销约 1.5x-2x 原始内容（Martin Kleppmann 的列式编码研究）
- 表格场景因元数据/值比较高，开销约 2x-3x（可通过压缩缓解）

---

## 四、生产级 CRDT 表格实现案例

### 4.1 Figma：CRDT 处理结构化数据的标杆

Figma 是最知名的 CRDT 结构化数据生产案例。其核心设计：

**数据模型**：
```
Figma Document = Map<ObjectID, Map<Property, Value>>
```
- 每个对象（设计元素）有唯一 ID
- 每个属性独立进行 Last-Writer-Wins
- 类似于二维表格的 `(rowId, colId) -> value` 映射

**关键设计决策**：
1. **属性级原子性**：冲突在属性边界解决，最终一致值总是某客户端发送的完整值
2. **中心化简化**：Figma 使用中心化服务器（Rust），不需要完全去中心化的 CRDT，因此省去了 CRDT 的部分开销
3. **Fractional Indexing**：使用分数索引用于子元素排序（与表格行列排序同原理）
4. **属性级冲突解决**：两人修改同一对象的不同属性（如一人改颜色，一人改位置），无冲突

**与表格的相似性**：Figma 的 `Map<ObjectID, Map<Property, Value>>` 模型与表格的 `Map<(rowId, colId), Value>` 本质等价。Figma 证明了 CRDT 完全适合处理结构化的、树状/表格状的数据。

**局限性**：
- 同一属性的并发修改使用 LWW，不保证字符级合并（文本属性并发会丢失中间状态）
- 这对设计工具可接受，对电子表格的文本单元格需要注意

### 4.2 Notion：混合 OT/CRDT 方案

Notion 采用 CRDT 技术但不纯粹：
- **文档结构（Block 层）**：使用 CRDT 处理 Block 树的并发操作
- **文本内容**：使用字符级 CRDT 或 OT 处理 Block 内的文本编辑
- **数据库/表格**：Notion Database 的协作细节未公开，推测使用类似 CRDT 的方案

Notion 的方案证明：**CRDT 可以与 OT 在同一产品中共存，各取所长**。

### 4.3 AppFlowy：Yrs 的最大规模生产验证

AppFlowy 是使用 Yrs 进行协作的典型案例：

| 维度 | 详情 |
|------|------|
| **CRDT 库** | Yrs（Rust），通过 AppFlowy-Collab 统一封装 |
| **应用场景** | 文档、数据库（Grid/Board/Calendar 视图）、文件夹、用户状态 |
| **前端** | Flutter（移动端）+ React（Web 端） |
| **后端** | Rust（AppFlowy Cloud） |
| **数据同步** | WebSocket + Yrs 增量同步协议 |
| **生产状态** | 已在生产环境运行，支持多用户实时协作 |

AppFlowy 的 `flowy-database2` 模块直接展示了如何用 Yrs 构建多维表格的数据库视图（Grid、Board、Calendar），三种视图共享同一底层数据。

### 4.4 其他相关项目

| 项目 | CRDT 使用方式 | 与多维表格的关联 |
|------|-------------|----------------|
| **Rows n' Columns** | Yjs 协作，Canvas 渲染（react-konva） | 直接的 React 电子表格组件，支持 Yjs/ShareDB/Loro 三种后端 |
| **AFFiNE** | 基于 Yjs/Yrs 的 CRDT | Block 级编辑器 + 数据库视图 |
| **Electric SQL** | Yjs 作为 AI Agent 的 CRDT Peer | 展示了 AI 可作为 CRDT 参与者 |
| **Loro** | 新兴高性能 CRDT（Rust） | 支持时间旅行、版本控制，v1.0 已发布 |

---

## 五、冲突解决机制深度对比

### 5.1 并发单元格编辑

**场景**：用户 A 和用户 B 同时编辑同一个单元格。

| 方案 | 处理方式 | 结果 |
|------|---------|------|
| **OT** | 两个 SetCell 操作进入 Transform 函数。通常采用后到达服务端的操作覆盖先到达的。 | 确定性，但依赖服务端顺序 |
| **CRDT (LWW)** | 每个单元格是 LWW Register，使用逻辑时钟（非物理时钟）判断"最后写入"。 | 确定性，不依赖服务端，但"最后"基于因果序而非时间序 |

**关键区别**：OT 的冲突解决由服务端控制（服务端决定操作顺序），CRDT 的冲突解决由算法本身保证（基于 Lamport 时钟或向量时钟）。

### 5.2 并发行插入

**场景**：用户 A 在第 5 行位置插入新行，同时用户 B 在第 3 行位置插入新行。

| 方案 | 处理方式 | 潜在问题 |
|------|---------|---------|
| **OT** | Transform 函数调整索引：A 的操作变为在第 6 行插入（因为 B 先插入了第 3 行），或 B 的操作不变。 | 需要精确定义索引偏移规则，边界条件多 |
| **CRDT** | 使用 Fractional Indexing：每行获得一个有序分数键（如 A 行 key=0.35, B 行 key=0.25），插入位置由键值排序决定。 | 可能出现交错（两人同时在同一位置插入，结果可能交替排列），但对表格场景可接受 |

### 5.3 Schema 变更与数据编辑并发

**场景**：用户 A 删除"价格"字段，同时用户 B 正在编辑"价格"列的某个单元格。

| 方案 | 处理方式 | 结果 |
|------|---------|------|
| **OT** | Transform 函数：A 的 DeleteField 和 B 的 SetCell 交叉。通常策略：删除字段后，正在编辑的单元格操作被丢弃或标记为冲突。 | 需要精心设计的 Transform 规则，容易遗漏边界情况 |
| **CRDT** | 字段集合是 CRDT OR-Set：删除"价格"字段从集合中移除。单元格数据在 `cells` YMap 中仍然存在（key 包含 field_id），但渲染时根据当前字段集合过滤。 | 数据不丢失（可以从 Undo 恢复），自然处理并发 |
| **推荐策略** | 使用"软删除"：标记字段为 `deleted: true` 而非真正删除。并发编辑的单元格在字段恢复后自动可见。 | 适用于 OT 和 CRDT |

### 5.4 行/列移动

**场景**：用户 A 将第 3 行移动到第 7 行，同时用户 B 将第 3 行移动到第 1 行。

| 方案 | 处理方式 | 复杂度 |
|------|---------|--------|
| **OT** | Move 操作需要特殊的 Transform 逻辑：Move(3→7) vs Move(3→1)。需要跟踪"同一行不能被两人同时移动到不同位置"的约束。 | 非常复杂，易出错 |
| **CRDT** | 使用 Fractional Indexing 的 Move = Delete + Insert with testament（继承链）：记录移动的源和目标，并发移动通过 LWW 选择一个结果。 | 复杂度可控，Bartosz Sypytkowski 有详细方案 |

---

## 六、Yrs (Rust) 集成技术细节

### 6.1 yrs-axum WebSocket 集成

`yrs-axum` 库（当前版本 0.8.2）提供了 Yrs 与 Axum 框架的 WebSocket 集成：

```rust
use axum::Router;
use yrs_axum::AwarenessExtension;

// 基本集成模式
let awareness = Awareness::new(Doc::new());
let awareness_ext = AwarenessExtension::new(awareness);

let app = Router::new()
    .route("/ws/:room_id", yrs_axum::handler(awareness_ext.clone()));
```

**集成模式**：
1. 每个"房间"（表格文档）对应一个 `Doc` 实例
2. `Awareness` 管理用户在线状态（光标、选区）
3. WebSocket 连接建立后，自动执行 Yjs 同步协议（两步握手）
4. 增量更新通过 WebSocket 广播给同一房间的所有客户端

**备选库**：`axum-ycrdt-websocket`（ crates.io 上的替代方案，基于 Tokio）。

### 6.2 数据持久化策略

Yrs 文档的持久化有多种方案：

| 策略 | 实现 | 适用场景 |
|------|------|---------|
| **全量编码** | `doc.encode_update_v1()` 或 `doc.encode_state_as_update_v1()` | 定期快照，启动时加载 |
| **增量更新** | 每次 transaction 后保存 `txn.encode_update_v1()` | 实时持久化，PostgreSQL JSONB 存储 |
| **PostgreSQL + Yrs** | 增量更新存入 `changesets` 表 + 定期全量快照 | 当前项目推荐 |
| **Redis 缓存** | 活跃文档保持在 Redis 中，冷文档存入 PG | 大规模场景 |

**推荐持久化架构**：
```
用户编辑 → Yjs 客户端 → WebSocket → Yrs 服务端 (Axum)
                                          ↓
                                    增量更新存储
                                    ├── Redis（热数据缓存）
                                    └── PostgreSQL（持久化 + 快照）
```

### 6.3 客户端：Yjs + React + Canvas 渲染

**Yjs 与 React 的集成**：

```typescript
import * as Y from 'yjs';
import { useYjs } from '@y-sweet/react';  // 或自定义 Hook

// 文档初始化
const ydoc = new Y.Doc();
const yTable = ydoc.getMap('table');
const yRows = yTable.get('rows') as Y.Array<Y.Map>;
const yCols = yTable.get('cols') as Y.Array<Y.Map>;
const yCells = yTable.get('cells') as Y.Map;

// 观察 cells 变化 → 触发 Canvas 重绘
yCells.observeDeep((events) => {
  // 提取变更的单元格位置
  // 触发 Canvas 局部重绘
  canvasRenderer.updateCells(changedCells);
});
```

**与 Canvas 渲染的配合**：
1. Yjs 作为数据源，Canvas 作为渲染层——两者职责分离
2. Yjs 的 `observeDeep` 提供细粒度的变更通知（哪些单元格被修改）
3. Canvas 渲染器只需重绘变更区域，不需要全量重绘
4. 用户编辑时，先更新 Yjs 数据（`yCells.set(key, value)`），Yjs 自动同步
5. Canvas 不直接管理状态，仅从 Yjs 数据渲染

**关键库**：
- `yjs`：核心 CRDT 库
- `y-websocket`：WebSocket 通信 Provider
- `y-protocols`：同步协议实现
- `@y-sweet/react`：React 绑定（可选）
- Rows n' Columns 的 `@rowsncolumns/y-spreadsheet`：直接的电子表格 Yjs 集成参考

### 6.4 多维表格的 Yjs 文档模型设计

基于 Bartosz Sypytkowski 的研究和 AppFlowy 的实践，推荐以下文档模型：

```typescript
// 顶层文档结构
Y.Doc {
  "table": YMap {
    "meta": YMap {
      "id": string,
      "name": string,
      "description": string,
      "createdBy": string,
      "createdAt": number,
    },
    "fields": YArray<YMap> {
      // 每个字段
      {
        "id": string,           // 唯一 ID（u32 hex）
        "name": string,         // 字段名
        "type": string,         // 字段类型：text, number, select, date...
        "options": YMap,        // 选项配置（下拉选项等）
        "width": number,        // 列宽
        "visible": boolean,     // 是否可见
        "order": string,        // Fractional Index 键
      }
    },
    "records": YArray<YMap> {
      // 每行记录
      {
        "id": string,           // 唯一 ID（u32 hex）
        "height": number,       // 行高
        "order": string,        // Fractional Index 键
      }
    },
    "cells": YMap {
      // 单元格数据，key = "{recordId}:{fieldId}"
      "a1b2:c3d4": any,        // 单元格值
      ...
    },
    "views": YArray<YMap> {
      // 视图配置
      {
        "id": string,
        "type": string,         // "grid" | "kanban" | "calendar" | ...
        "name": string,
        "filter": YMap,         // 筛选条件
        "sort": YArray,         // 排序规则
        "group": YMap,          // 分组规则
        "fieldOrder": YArray,   // 字段显示顺序（Fractional Index）
        "recordOrder": YArray,  // 记录显示顺序（Fractional Index）
      }
    },
    "automation": YMap { ... }, // 自动化配置
  }
}
```

**设计要点**：
1. **cells 独立于 records**：单元格数据用 YMap + 复合键，避免 YArray 的 `O(N^2)` 问题
2. **Fractional Index for ordering**：行/列的显示顺序使用分数索引，支持并发重排
3. **字段集合用 YArray**：支持并发增删字段，每个字段的属性可独立修改
4. **视图配置用 YMap/YArray**：不同视图的筛选/排序/分组独立管理

---

## 七、迁移路径分析：从 OT 到 CRDT

### 7.1 OT 与 CRDT 能否共存？

**可以共存**，且有学术和生产案例支持：

1. **Notion 模式**：文档结构用 CRDT，文本编辑用 OT/字符级 CRDT
2. **IEEE 论文（2025）**：《Design and Implementation of a CRDT-OT Hybrid Client-Based System》提出客户端混合架构
3. **Inria 论文**：《Merging OT and CRDT Algorithms》探索算法层面的融合

**共存架构**：
```
┌──────────── 前端 ────────────┐
│  CRDT 客户端 (Yjs)           │  ← 新功能使用 CRDT
│  + OT 客户端 (兼容层)        │  ← 旧功能继续使用 OT
├──────────── API 层 ──────────┤
│  NestJS + 双协议网关         │
│  ├── CRDT WebSocket (Yjs)   │  ← 新连接
│  └── OT WebSocket (兼容)    │  ← 旧连接
├──────────── 数据层 ──────────┤
│  PostgreSQL (统一存储)       │
│  ├── changesets (OT 历史)    │
│  ├── crdt_updates (CRDT)    │
│  └── snapshots (共享)        │
└──────────────────────────────┘
```

### 7.2 推荐迁移策略

**方案 A：直接切换（推荐新项目）**
- 适用：项目尚未大规模上线
- 成本：一次性重写协作层
- 优势：架构统一，无兼容负担

**方案 B：渐进迁移（已有 OT 系统）**
- 阶段 1：新功能（视图协作、自动化协作）使用 CRDT
- 阶段 2：单元格编辑迁移到 CRDT
- 阶段 3：行/列操作迁移到 CRDT
- 阶段 4：下线 OT 服务
- 预估周期：3-6 个月

**方案 C：混合架构（长期）**
- CRDT 处理数据操作（单元格、行、列）
- OT 处理需要强意图保留的操作（富文本字段）
- 优势：各取所长
- 劣势：两套系统维护成本

### 7.3 当前项目的建议

由于项目仍在设计阶段（无生产数据），**建议采用方案 A（直接切换）**：
- 跳过 OT 的实现和调试成本
- 直接享受 CRDT 的离线支持和 Rust 生态优势
- 避免后期迁移的复杂性

---

## 八、Loro：另一个值得关注的 Rust CRDT

### 8.1 Loro 概览

Loro 是一个新兴的高性能 Rust CRDT 库，2024 年底发布 v1.0：

| 特性 | Loro | Yjs/Yrs |
|------|------|---------|
| **语言** | Rust（核心），JS/Swift 绑定 | JS（Yjs），Rust（Yrs） |
| **时间旅行** | 原生支持 `doc.checkout(frontiers)` | 需手动实现快照/回放 |
| **版本控制** | 内建 Shallow History | 需外部实现 |
| **Move 操作** | 原生支持 `container.move()` | 需 Delete+Insert with testament |
| **性能** | 声称优于 Yjs（文档加载、时间旅行） | 成熟优化，久经考验 |
| **生产验证** | 较新，社区验证少 | Yjs 久经考验，Yrs 被 AppFlowy 验证 |
| **生态** | 较小 | Yjs 生态丰富（Provider、绑定） |

### 8.2 Loro 的优势场景

Loro 在以下场景可能有优势：
- 需要时间旅行（undo/redo 跨版本）
- 需要原生 Move 操作（行列拖拽排序）
- 需要 Rust 原生的高性能 CRDT（无 Yjs 兼容性需求）

### 8.3 对当前项目的建议

**短期推荐 Yrs**：生态成熟、AppFlowy 验证、与 Yjs 前端无缝互操作。
**长期关注 Loro**：如果其生态成熟，Move 操作和时间旅行特性对多维表格非常有价值。

---

## 九、技术决策更新建议

### 9.1 推荐方案：CRDT（Yjs + Yrs）

基于以上研究，建议将实时协作方案从 OT 更新为 CRDT：

```
更新前（OT）：
前端 OT 客户端 → NestJS OT 服务器 → PostgreSQL Changesets

更新后（CRDT）：
前端 Yjs 客户端 → Rust Yrs 服务端 (Axum) → PostgreSQL + Redis
                    ↓ (可选)
               NestJS API 层（业务逻辑）
```

### 9.2 更新后的架构

```
┌──────────── 前端 ────────────────────────┐
│  React + Next.js                         │
│  Canvas 表格渲染（Konva/fabris.js）       │
│  Yjs 客户端 + Awareness（光标/选区）      │
│  HyperFormula 公式引擎                    │
│  y-websocket Provider                    │
├──────────── API 层 ──────────────────────┤
│  Rust (Axum + Yrs) — 协作服务             │
│  ├── WebSocket 连接管理                   │
│  ├── Yrs 文档同步                         │
│  ├── 增量更新持久化                        │
│  └── Awareness 管理                       │
│                                          │
│  NestJS (TypeScript) — 业务 API           │
│  ├── RESTful API（认证、权限、文件等）     │
│  ├── 自动化工作流引擎                     │
│  └── Webhook 推送                         │
├──────────── 数据层 ──────────────────────┤
│  PostgreSQL (JSONB)                      │
│  ├── 元数据 (tables/fields/views)         │
│  ├── CRDT 更新日志                        │
│  ├── 定期快照                             │
│  └── 业务数据                             │
│  Redis (缓存 + 队列 + 活跃文档)           │
├──────────── 可选扩展 ─────────────────────┤
│  Meilisearch (全文搜索)                   │
│  ClickHouse (OLAP 分析)                  │
│  MinIO (文件存储)                         │
└──────────────────────────────────────────┘
```

### 9.3 核心架构变更总结

| 变更项 | OT 方案 | CRDT 方案 | 影响 |
|--------|---------|-----------|------|
| **协作服务** | NestJS (TypeScript) | Rust (Axum + Yrs) | 后端引入 Rust，提升性能 |
| **客户端协议** | 自定义 OT 协议 | Yjs 标准协议 | 减少协议设计工作量 |
| **离线支持** | 需自建排队机制 | Yjs 天然支持 | 大幅简化离线逻辑 |
| **版本控制** | Changeset + Snapshot | Yjs 内建 Snapshot + 增量 | 减少自建代码量 |
| **AI 集成** | AI 作为独立客户端 | AI 作为 CRDT Peer | 更自然的 AI 协作模式 |
| **数据模型** | PostgreSQL JSONB 直接操作 | Yjs 文档 → 定期同步到 PG | 需要文档-关系映射层 |
| **混合架构** | 全 TS 栈 | Rust 协作 + TS 业务 | 两个后端服务 |

### 9.4 风险与缓解

| 风险 | 影响 | 缓解措施 |
|------|------|---------|
| Yrs 文档过大（大数据量表） | 内存压力 | 分片加载、虚拟化、定期 GC |
| Rust 与 NestJS 双后端维护 | 运维复杂度 | Docker Compose 统一部署、共享 PG |
| CRDT 元数据开销（2-3x） | 存储和网络成本 | zstd 压缩、增量同步、列式编码 |
| 团队 Rust 经验不足 | 开发效率 | Yrs 封装良好，核心代码量不大 |
| LWW 丢失编辑意图 | 同单元格冲突时用户体验 | 提示冲突、显示冲突历史、Undo 支持 |
| Yrs 生态变化风险 | 长期维护 | Yrs 由 Yjs 作者参与维护，MIT 许可 |

---

## 十、行动建议与下一步

### 10.1 短期行动（1-2 周）

1. **概念验证（PoC）**：
   - 用 Yrs 搭建一个最小的 Axum WebSocket 服务
   - 前端用 Yjs 连接，验证基本的数据同步
   - 测试 1000 行 x 10 列的表格操作性能

2. **数据模型验证**：
   - 按照 Section 6.4 的文档模型实现 Yjs 文档结构
   - 验证单元格编辑、行/列增删的并发行为

### 10.2 中期规划（1-2 月）

1. **Rust 协作服务开发**：
   - yrs-axum WebSocket 服务
   - PostgreSQL 持久化（增量更新 + 定期快照）
   - Redis 缓存活跃文档

2. **前端迁移**：
   - Yjs 客户端集成（替换 OT 客户端）
   - Canvas 渲染与 Yjs 数据绑定
   - Awareness（光标/选区）实现

### 10.3 技术决策更新清单

需要更新的文档和决策：

- [ ] `notes.md` — 更新技术决策表（OT → CRDT）
- [ ] `tech-stack-selection.md` — 更新后端技术栈（加入 Rust 协作服务）
- [ ] `ot-implementation-detail.md` — 标注为"已弃用"或"参考文档"
- [ ] `crdt-realtime-collaboration.md` — 更新为完整的 CRDT 方案文档
- [ ] `rust-ecosystem-research.md` — 更新 Yrs 集成方案
- [ ] 架构总览图 — 更新为 Rust 协作 + NestJS 业务的双后端架构
- [ ] `version-control-undo-redo.md` — 基于 Yjs 内建能力重新设计

---

## 十一、结论

经过对 OT 和 CRDT 在多维表格场景下的深度对比研究，**建议将实时协作方案从 OT 切换为 CRDT（Yjs + Yrs）**。主要理由：

1. **Rust 生态决定性因素**：Yrs 是生产级 CRDT 库（MIT 许可、AppFlowy 验证），而 Rust 没有成熟 OT 库
2. **结构化数据天然适配**：CRDT 的单元格级 LWW、Fractional Indexing、CRDT Set 分别解决单元格冲突、行/列排序、Schema 变更
3. **离线支持**：Yjs 天然支持离线编辑和重连同步，对 Local-First 架构至关重要
4. **实现复杂度**：CRDT 避免了 O(N^2) Transform 函数的实现和验证成本
5. **行业趋势**：Figma、Notion、AppFlowy 等成功产品证明了 CRDT 在结构化数据场景的可行性
6. **AI 集成**：AI Agent 可作为 CRDT Peer 参与协作，比 OT 模式更自然

**核心权衡**：CRDT 的元数据开销（2-3x）和双后端架构复杂度是主要代价，但通过压缩和合理的架构设计可以有效缓解。

---

## 参考链接

### 核心研究
- [Can Yrs fit my table? - Bartosz Sypytkowski](https://www.bartoszsypytkowski.com/yrs-csv-table/) — Yrs 表格数据模型设计与性能测试
- [Conflict-free Replicated Spread Sheets - Bartosz Sypytkowski](https://www.bartoszsypytkowski.com/crdt-tables/) — CRDT 电子表格架构深度解析
- [Deep dive into Yrs architecture - Bartosz Sypytkowski](https://www.bartoszsypytkowski.com/yrs-architecture/) — Yrs 内部架构详解
- [A Study of Semantics for CRDT-based Collaborative Spreadsheets (ACM)](https://dl.acm.org/doi/pdf/10.1145/3578358.3591324) — CRDT 电子表格语义研究论文

### 生产案例
- [How Figma's multiplayer technology works](https://www.figma.com/blog/how-figmas-multiplayer-technology-works/) — Figma CRDT 架构官方文章
- [AppFlowy-Collab (GitHub)](https://github.com/AppFlowy-IO/AppFlowy-Collab) — AppFlowy Yrs 协作实现
- [How we built AppFlowy with Flutter and Rust](https://appflowy.com/blog/tech-design-flutter-rust) — AppFlowy 技术架构
- [Rows n' Columns Yjs Collaboration](https://docs.rowsncolumns.app/collaboration/yjs-collaboration) — React 电子表格 Yjs 集成

### OT vs CRDT 对比
- [OT vs CRDT in 2026 - Taskade](https://www.taskade.com/blog/ot-vs-crdt) — 2026 年度 OT/CRDT 综合对比
- [Merging OT and CRDT Algorithms (Inria)](https://inria.hal.science/hal-00957167/PDF/main.pdf) — OT/CRDT 融合算法论文
- [Design and Implementation of a CRDT-OT Hybrid (IEEE 2025)](https://ieeexplore.ieee.org/abstract/document/11265238/) — CRDT-OT 混合系统实现
- [CRDTs vs Operational Transformation: A Practical Guide](https://hackernoon.com/crdts-vs-operational-transformation-a-practical-guide-to-real-time-collaboration) — 实践指南

### Yjs/Yrs 技术文档
- [Yjs GitHub](https://github.com/yjs/yjs) — Yjs 核心库
- [Yjs Shared Types Docs](https://docs.yjs.dev/getting-started/working-with-shared-types) — 共享类型 API
- [yrs-axum (Docs.rs)](https://docs.rs/crate/yrs-axum/latest) — Yrs Axum 集成
- [Yjs Internals](https://docs.yjs.dev/api/internals) — Yjs 内部原理
- [CRDT Benchmarks](https://github.com/dmonad/crdt-benchmarks) — CRDT 性能基准测试

### Loro CRDT
- [Loro GitHub](https://github.com/loro-dev/loro) — Loro CRDT 库
- [Loro Time Travel](https://loro.dev/docs/tutorial/time_travel) — 时间旅行功能
- [Loro Performance](https://loro.dev/docs/performance) — 性能对比

### 其他
- [Designing Data Structures for Collaborative Apps - Matthew Weidner](https://mattweidner.com/2022/02/10/collaborative-data-design.html) — CRDT 数据结构设计方法论
- [Architectures for Central Server Collaboration - Matthew Weidner](https://mattweidner.com/2024/06/04/server-architectures.html) — 中心化服务器协作架构
- [CRDTs Go Brrr - Joseph Gentle](https://josephg.com/blog/crdts-go-brrr/) — CRDT 性能优化
- [AI Agents as CRDT Peers - Electric SQL](https://electric-sql.com/blog/2026/04/08/ai-agents-as-crdt-peers-with-yjs) — AI 作为 CRDT Peer
- [Horusiath/crdt-table (GitHub)](https://github.com/Horusiath/crdt-table) — CRDT 表格 PoC 实现
