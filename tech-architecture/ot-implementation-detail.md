# OT（操作转换）算法实现详解

## 概述

本文档深入研究 OT（Operational Transformation，操作转换）算法在多维表格协同编辑场景中的实现细节。项目最终采用 OT 而非 CRDT 作为实时协作的核心方案，主要参考 APITable 的 OT 实现架构，后端基于 NestJS + TypeScript。

OT 是一种用于实时协同编辑的并发控制算法，通过对并发操作进行转换（Transform），确保多个用户同时编辑同一文档时，所有副本最终达到一致状态，同时尽可能保持用户操作意图。

---

## 1. OT 基础算法

### 1.1 核心思想

OT 的核心思想可以概括为：

1. **操作（Operation）** 是协同编辑的最小单位，描述一次用户编辑行为
2. **转换（Transform）** 是 OT 的核心函数——当两个操作并发执行时，Transform 调整它们的位置/参数，使得以不同顺序应用都能收敛到相同结果
3. **乐观执行（Optimistic UI）** 客户端的操作立即在本地生效，不需要等待服务器确认

用数学语言描述 OT 的收敛性质（TP1）：

```
对于任意初始状态 S 和两个并发操作 a, b：
apply(apply(S, a), transform(b, a)) = apply(apply(S, b), transform(a, b))

即：先应用 a 再应用转换后的 b，与先应用 b 再应用转换后的 a，结果相同
```

### 1.2 经典文本 OT：Insert/Delete 的 Pairwise Transform

#### 操作定义

文本 OT 定义三种基本操作：

```typescript
// 插入操作
interface InsertOp {
  type: 'insert';
  position: number;  // 插入位置
  text: string;      // 插入内容
  clientId: string;  // 客户端标识（用于解决相同位置冲突）
}

// 删除操作
interface DeleteOp {
  type: 'delete';
  position: number;  // 删除起始位置
  length: number;    // 删除长度
}

// 保留操作（Google Wave 模型中使用）
interface RetainOp {
  type: 'retain';
  count: number;     // 跳过的字符数
}

type TextOp = InsertOp | DeleteOp | RetainOp;
```

#### Transform 函数签名

```typescript
/**
 * Transform 函数：给定两个基于同一版本的操作 op1 和 op2，
 * 返回 [op1', op2']，使得：
 *   apply(apply(doc, op1), op2') === apply(apply(doc, op2), op1')
 *
 * @param op1 第一个操作
 * @param op2 第二个操作
 * @param isLeftBias 当两个操作在相同位置插入时，op1 是否优先（左偏策略）
 * @returns [op1', op2'] 转换后的操作对
 */
function transform(
  op1: TextOp,
  op2: TextOp,
  isLeftBias: boolean
): [TextOp, TextOp];
```

#### Insert vs Insert

```typescript
function transformInsertInsert(
  op1: InsertOp,
  op2: InsertOp
): InsertOp {
  // op1 在 op2 之前 → op2 的位置需要右移
  if (op1.position < op2.position) {
    return { ...op2, position: op2.position + op1.text.length };
  }
  // op1 在 op2 之后 → op2 不变
  if (op1.position > op2.position) {
    return op2;
  }
  // 相同位置：使用 clientId 确定性排序（左偏策略）
  // 先到达服务器的操作排在左边
  if (op1.clientId < op2.clientId) {
    return { ...op2, position: op2.position + op1.text.length };
  }
  return op2;
}
```

#### Insert vs Delete

```typescript
function transformInsertDelete(
  insertOp: InsertOp,
  deleteOp: DeleteOp
): DeleteOp {
  // 插入在删除范围之后 → 不影响
  if (insertOp.position >= deleteOp.position + deleteOp.length) {
    return deleteOp;
  }
  // 插入在删除之前 → 删除位置右移
  if (insertOp.position <= deleteOp.position) {
    return { ...deleteOp, position: deleteOp.position + insertOp.text.length };
  }
  // 插入在删除范围内 → 分割删除操作
  // 这里简化处理：扩展删除范围
  return {
    ...deleteOp,
    length: deleteOp.length + insertOp.text.length,
  };
}
```

#### Delete vs Delete

```typescript
function transformDeleteDelete(
  op1: DeleteOp,
  op2: DeleteOp
): DeleteOp | null {
  const op1End = op1.position + op1.length;
  const op2End = op2.position + op2.length;

  // op1 完全在 op2 之前 → op2 位置左移
  if (op1End <= op2.position) {
    return { ...op2, position: op2.position - op1.length };
  }
  // op1 完全在 op2 之后 → op2 不变
  if (op1.position >= op2End) {
    return op2;
  }
  // op1 完全包含 op2 → op2 变为空操作
  if (op1.position <= op2.position && op1End >= op2End) {
    return null;
  }
  // op2 完全包含 op1 → op2 缩减长度
  if (op1.position >= op2.position && op1End <= op2End) {
    return { ...op2, length: op2.length - op1.length };
  }
  // 部分重叠
  if (op1.position < op2.position) {
    const overlap = op1End - op2.position;
    return { ...op2, position: op1.position, length: op2.length - overlap };
  }
  const overlap = op2End - op1.position;
  return { ...op2, length: op2.length - overlap };
}
```

#### 组合 Transform 函数

```typescript
function transform(
  op1: TextOp,
  op2: TextOp,
  isLeftBias: boolean = true
): [TextOp, TextOp] {
  if (op1.type === 'insert' && op2.type === 'insert') {
    const op2Prime = transformInsertInsert(op1, op2);
    // 对称地计算 op1'
    const op1Prime = transformInsertInsert(op2, op1);
    return [op1Prime, op2Prime];
  }
  if (op1.type === 'insert' && op2.type === 'delete') {
    return [op1, transformInsertDelete(op1, op2)];
  }
  if (op1.type === 'delete' && op2.type === 'insert') {
    return [transformInsertDelete(op2, op1), op2];
  }
  if (op1.type === 'delete' && op2.type === 'delete') {
    const op2Prime = transformDeleteDelete(op1, op2);
    const op1Prime = transformDeleteDelete(op2, op1);
    return [op1Prime ?? { type: 'retain', count: 0 }, op2Prime ?? { type: 'retain', count: 0 }];
  }
  throw new Error(`Unknown operation pair: ${op1.type} vs ${op2.type}`);
}
```

### 1.3 Google Wave OT 白皮书要点

Google Wave 的 OT 实现是对经典 OT 的重要扩展，其核心设计包括：

#### 文档操作流式接口

Wave 将文档操作设计为流式（streaming）接口，操作由一系列有序的文档变更组成：

```
文档操作 = [mutation1, mutation2, mutation3, ...]
```

每个 mutation 按线性顺序遍历文档时依次应用。基本 mutation 类型：

| Mutation | 说明 |
|----------|------|
| `retain(N)` | 跳过 N 个位置 |
| `insert characters` | 插入字符 |
| `insert element start` | 插入 XML 开始标签 |
| `insert element end` | 插入 XML 结束标签 |
| `delete characters` | 删除字符 |
| `delete element start` | 删除开始标签 |
| `delete element end` | 删除结束标签 |
| `replace attributes` | 替换属性 |
| `update attributes` | 更新属性 |
| `annotation boundary` | 注解边界（用于格式化） |

#### 客户端等待确认（ACK）机制

Wave OT 对经典 OT 做了一个重要修改：**客户端必须等待服务器确认（ACK）后才能发送更多操作**。

```
优势：
  - 服务器只需维护单一状态空间（操作历史）
  - 客户端可以推断服务器的 OT 路径
  - 大幅简化服务器算法

代价：
  - 客户端看到其他用户的操作是"批量"的，间隔约一个 RTT
  - 客户端需要缓存等待 ACK 期间产生的本地操作
```

#### 操作组合（Composition）

Wave 支持操作组合——两个操作可以合并为一个操作：

```
Composition: B·A 满足 (B·A)(doc) = B(A(doc))
```

客户端等待 ACK 期间，会将所有待发送操作组合成一个操作，减少 Transform 和传输次数。

### 1.4 Jupiter 协调算法

Jupiter 算法是 OT 的经典服务器协调方案，由 Nichols 等人于 1995 年提出，Google Docs 即基于此算法。

#### 核心模型

```
     Client A                    Server                    Client B
        |                          |                          |
   [state A]                  [server state]             [state B]
        |                          |                          |
   opA(local) ──── send ────→  transform(opA)         opB(local)
        |                    apply to server          ──── send ────→
   apply(opA)               broadcast(opA')               |
        |                          |                  transform(opB)
   receive(opB') ←── broadcast ────|                  apply to state
   transform(opB')                 |                  receive(opA')
   apply(opB')              receive(opB) ──── send ────→
        |                    transform(opB)           transform(opA')
                               apply(opB')
                               broadcast(opB')
```

#### 关键特性

1. **中央服务器序列化**：所有操作必须经过服务器，服务器决定全局顺序
2. **单状态空间**：服务器维护一个线性操作历史，收到客户端操作后依次 Transform
3. **客户端 ACK 机制**：客户端等待 ACK，减少服务器为每个客户端维护状态空间的开销
4. **版本号（Revision）**：每个操作携带 `baseRevision` 和服务器分配的 `revision`

#### 收敛保证

Jupiter 通过以下机制保证收敛：

```
条件1 (TP1): apply(apply(S, a), T(b, a)) = apply(apply(S, b), T(a, b))
  → 两个并发操作以任意顺序应用后结果一致

条件2 (TP2): T(T(c, a), T(b, a)) = T(T(c, b), T(a, b))
  → 三个或更多并发操作的 Transform 也能收敛
  → 实际中通过服务器序列化来简化，不需要严格满足 TP2
```

### 1.5 结构化数据 OT：多维表格的 Transform 设计

多维表格的数据结构远比纯文本复杂，需要设计针对表格结构的 Transform 函数。

#### 操作分类

```typescript
// 表格中的操作类型
enum OpType {
  // 单元格级别
  SetCellValue = 'setCellValue',         // 设置单元格值
  ClearCellValue = 'clearCellValue',     // 清空单元格

  // 行级别
  InsertRow = 'insertRow',               // 插入行
  DeleteRow = 'deleteRow',               // 删除行
  MoveRow = 'moveRow',                   // 移动行

  // 列（字段）级别
  InsertField = 'insertField',           // 插入字段
  DeleteField = 'deleteField',           // 删除字段
  MoveField = 'moveField',               // 移动字段
  ModifyFieldProperty = 'modifyField',   // 修改字段属性

  // 视图级别
  SetFilter = 'setFilter',              // 设置筛选
  SetSort = 'setSort',                  // 设置排序
  SetGroup = 'setGroup',                // 设置分组

  // 表级别
  AddView = 'addView',                  // 添加视图
  DeleteView = 'deleteView',            // 删除视图
}
```

#### 表格操作数据结构

```typescript
interface TableOp {
  type: OpType;
  // 操作坐标——定位操作影响的区域
  coord: {
    rowIndex?: number;       // 行索引
    fieldId?: string;        // 字段ID
    viewId?: string;         // 视图ID
  };
  // 操作参数
  params: Record<string, any>;
  // 元数据
  baseRevision: number;     // 基于的版本号
  revision?: number;        // 服务器分配的版本号
  opId: string;             // 操作全局唯一ID（用于去重）
  userId: string;           // 操作发起者
  timestamp: number;        // 时间戳
}
```

#### 关键 Pairwise Transform 场景

**场景1：同单元格并发编辑**

```typescript
// Alice 设置 C2 = "Hello"，Bob 同时设置 C2 = "World"
// 策略：Last-Write-Wins（基于服务器接收顺序）
function transformSetCellVsSetCell(op1: TableOp, op2: TableOp): [TableOp, TableOp] {
  if (op1.coord.fieldId === op2.coord.fieldId && op1.coord.rowIndex === op2.coord.rowIndex) {
    // 同一单元格：op1 先被服务器接受，op2 需要覆盖
    // op1' = no-op（因为 op2 会覆盖），op2' = op2
    return [
      { ...op1, type: OpType.ClearCellValue, params: {} }, // 或直接变为 no-op
      op2
    ];
  }
  // 不同单元格：互不影响
  return [op1, op2];
}
```

**场景2：行插入 vs 单元格编辑**

```typescript
// Alice 在第 3 行前插入一行，Bob 同时编辑第 5 行的单元格
function transformInsertRowVsSetCell(op1: TableOp, op2: TableOp): [TableOp, TableOp] {
  if (op1.type === OpType.InsertRow) {
    const insertIndex = op1.coord.rowIndex;
    const cellRowIndex = op2.coord.rowIndex;
    if (insertIndex <= cellRowIndex) {
      // 插入在编辑行之前 → 编辑操作的行号 +1
      return [op1, { ...op2, coord: { ...op2.coord, rowIndex: cellRowIndex + 1 } }];
    }
    // 插入在编辑行之后 → 不影响
    return [op1, op2];
  }
  // 对称处理
  return transformInsertRowVsSetCell(op2, op1);
}
```

**场景3：列插入 vs 单元格编辑**

```typescript
// Alice 在 B 列前插入一列，Bob 同时编辑 C2 单元格
function transformInsertFieldVsSetCell(op1: TableOp, op2: TableOp): [TableOp, TableOp] {
  // 列的插入不影响其他列的单元格编辑
  // 因为字段用 ID 而非索引定位
  return [op1, op2];
}
```

**场景4：行删除 vs 行删除**

```typescript
// Alice 删除第 3 行，Bob 同时删除第 5 行
function transformDeleteRowVsDeleteRow(op1: TableOp, op2: TableOp): [TableOp, TableOp | null] {
  const idx1 = op1.coord.rowIndex;
  const idx2 = op2.coord.rowIndex;
  if (idx1 === idx2) {
    // 删除同一行：第二个变为 no-op
    return [op1, null];
  }
  if (idx1 < idx2) {
    return [op1, { ...op2, coord: { ...op2.coord, rowIndex: idx2 - 1 } }];
  }
  return [{ ...op1, coord: { ...op1.coord, rowIndex: idx1 - 1 } }, op2];
}
```

**场景5：列删除 vs 同列单元格编辑**

```typescript
// Alice 删除 B 列，Bob 同时编辑 B2 单元格
function transformDeleteFieldVsSetCell(op1: TableOp, op2: TableOp): [TableOp, TableOp | null] {
  if (op1.coord.fieldId === op2.coord.fieldId) {
    // 编辑的列被删除 → 编辑操作变为 no-op（或产生冲突）
    return [op1, null];
  }
  // 不同列：互不影响
  return [op1, op2];
}
```

#### Transform 矩阵

对于 N 种操作类型，需要实现 O(N^2) 个 Transform 函数。以下是需要覆盖的核心矩阵：

```
                 SetCell  InsertRow  DeleteRow  InsertField  DeleteField  MoveRow  MoveField
SetCell           LWW      shift↓     shift↑      no-effect    null/冲突    shift↓   no-effect
InsertRow         shift↑   adjust     conflict    no-effect    no-effect   adjust   no-effect
DeleteRow         shift↓   conflict   adjust      no-effect    no-effect   adjust   no-effect
InsertField      no-effect no-effect no-effect   adjust       conflict    no-effect adjust
DeleteField       null     no-effect  no-effect   conflict     adjust      no-effect adjust
MoveRow           shift↑   adjust     adjust      no-effect    no-effect   adjust   adjust
MoveField        no-effect no-effect no-effect   adjust       adjust      no-effect adjust
```

---

## 2. APITable OT 源码分析

### 2.1 代码结构

APITable 是一个基于 OT 实现实时协同编辑的开源多维表格项目，其后端使用 NestJS (TypeScript) + Java (Spring Boot) 双栈。核心 OT 模块在 TypeScript 侧。

```
APITable 仓库中的关键 OT 相关目录：
├── packages/core-server/          # NestJS 后端核心
│   ├── src/ot/                    # OT 引擎核心模块
│   │   ├── ot.service.ts          # OT 服务：接收、Transform、广播
│   │   ├── ot.gateway.ts          # WebSocket 网关
│   │   └── ot.module.ts           # OT NestJS 模块
│   ├── src/changeset/             # Changeset 管理
│   │   ├── changeset.service.ts   # Changeset 持久化
│   │   └── changeset.module.ts
│   ├── src/snapshot/              # 快照管理
│   │   ├── snapshot.service.ts    # 快照生成与加载
│   │   └── snapshot.module.ts
│   └── src/socket/                # WebSocket 连接管理
│       ├── socket.gateway.ts      # Socket.IO 网关
│       └── socket.module.ts
├── packages/core-sdk/             # 前端 SDK
│   └── src/ot/                    # 前端 OT 客户端
│       ├── ot-client.ts           # OT 客户端逻辑
│       └── ot-operation.ts        # 操作定义
└── packages/ot-json/              # JSON0 OT 类型实现
    ├── src/
    │   ├── json0.ts               # JSON0 Transform/Apply/Compose/Invert
    │   └── types.ts               # 类型定义
    └── README.md
```

### 2.2 Operation/Changeset 数据结构

APITable 使用 JSON0 作为 OT 的底层算法，并在此基础上构建了适合表格场景的操作模型。

#### JSON0 操作格式

APITable 采用 [ottypes/json0](https://github.com/ottypes/json0) 规范来描述对 JSON 数据的操作：

```typescript
// JSON0 操作格式
// 每个操作组件包含一个 path（路径）和具体的操作内容

// 列表操作
{ p: ['fieldMap', 2], li: newFieldObject }            // 在 fieldMap 索引 2 插入字段
{ p: ['fieldMap', 2], ld: oldFieldObject }            // 删除 fieldMap 索引 2 的字段
{ p: ['fieldMap', 2], ld: old, li: new }              // 替换字段
{ p: ['fieldMap', 3], lm: 5 }                         // 将索引 3 的字段移动到索引 5

// 对象操作
{ p: ['fieldMap', 'fldXXXXX'], oi: fieldObj }         // 插入对象属性
{ p: ['fieldMap', 'fldXXXXX'], od: fieldObj }         // 删除对象属性
{ p: ['fieldMap', 'fldXXXXX'], od: old, oi: new }     // 替换对象属性

// 数值操作
{ p: ['fieldMap', 'fldXXXXX', 'property', 'width'], na: 20 }  // 数值增加 20

// 字符串操作（使用 text0 子类型）
{ p: ['recordMap', 'recXXXXX', 'fields', 'fldXXXXX', 3], si: 'Hello' }  // 在偏移 3 插入字符串
{ p: ['recordMap', 'recXXXXX', 'fields', 'fldXXXXX', 3], sd: 'Hello' }  // 在偏移 3 删除字符串
```

#### Changeset 数据结构

APITable 将多个 Operation 封装为 Changeset（变更集）：

```typescript
interface IChangeset {
  id: string;               // Changeset 唯一标识
  datasheetId: string;      // 所属数据表 ID
  revision: number;         // 版本号（服务器分配，全局递增）
  operations: Json0Op[];    // JSON0 操作数组
  userId: string;           // 操作发起者
  createdAt: number;        // 创建时间
  messageId: string;        // 消息唯一 ID（用于去重和 ACK）
}

// JSON0 操作类型
type Json0Op = 
  | { p: (string | number)[], li?: any, ld?: any, lm?: number, oi?: any, od?: any, na?: number }
  | { p: (string | number)[], si?: string, sd?: string }
  | { p: (string | number)[], t: string, o: any[] };  // 子类型操作
```

#### Snapshot 数据结构

```typescript
interface ISnapshot {
  datasheetId: string;      // 数据表 ID
  revision: number;         // 快照对应的版本号
  data: {
    fieldMap: Record<string, IField>;       // 字段映射
    recordMap: Record<string, IRecord>;     // 记录映射
    viewMap: Record<string, IView>;         // 视图映射
    // ... 其他元数据
  };
  createdAt: number;
}
```

### 2.3 OT Server 核心流程

APITable 的 OT Server 采用典型的 Jupiter 模式，核心流程如下：

```
┌──────────────────────────────────────────────────────────────────────┐
│                         OT Server 核心流程                           │
├──────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  1. 接收操作                                                         │
│     Client ──WebSocket──→ Gateway ──→ OTService.handleOperation()   │
│     接收: { operations, baseRevision, messageId, datasheetId }       │
│                                                                      │
│  2. 版本校验                                                         │
│     检查 baseRevision 是否合法                                        │
│     baseRevision 必须在 [lastSnapshotRevision, currentRevision] 之间 │
│                                                                      │
│  3. 操作 Transform                                                   │
│     for i in range(baseRevision, currentRevision):                   │
│       op = json0.transform(op, historyOps[i], 'left')                │
│     // 将客户端操作与服务器上所有后续操作逐一 Transform               │
│                                                                      │
│  4. 应用操作                                                         │
│     newSnapshot = json0.apply(currentSnapshot, transformedOp)        │
│     currentRevision++                                                │
│                                                                      │
│  5. 持久化                                                           │
│     → 保存 Changeset 到数据库（operations + revision）               │
│     → 更新内存中的 Snapshot                                           │
│     → 如果 revision 是快照间隔的倍数，触发快照保存                    │
│                                                                      │
│  6. 响应                                                             │
│     → ACK: 向发送者返回 { type: 'ack', revision, messageId }         │
│     → Broadcast: 向同数据表的其他用户广播 Transform 后的操作         │
│       { type: 'op', operations: op', revision }                      │
│                                                                      │
└──────────────────────────────────────────────────────────────────────┘
```

#### NestJS 实现（伪代码）

```typescript
@Injectable()
export class OtService {
  // 内存中维护每个 datasheet 的操作历史和快照
  private datasheetStates: Map<string, DatasheetState> = new Map();

  constructor(
    private readonly changesetRepo: ChangesetRepository,
    private readonly snapshotService: SnapshotService,
  ) {}

  async handleOperation(
    datasheetId: string,
    operations: Json0Op[],
    baseRevision: number,
    messageId: string,
    userId: string,
  ): Promise<{ transformedOps: Json0Op[]; revision: number }> {
    const state = this.getOrCreateState(datasheetId);

    // 1. 去重检查
    if (state.processedMessageIds.has(messageId)) {
      return { transformedOps: [], revision: state.revision };
    }

    // 2. Transform：将客户端操作与服务器的操作历史对齐
    let transformedOps = operations;
    for (let i = baseRevision; i < state.revision; i++) {
      const historicalOp = state.operationsHistory[i];
      transformedOps = json0.transform(transformedOps, historicalOp, 'left');
    }

    // 3. 应用到当前快照
    const newSnapshot = json0.apply(state.snapshot, transformedOps);
    state.revision++;
    state.snapshot = newSnapshot;
    state.operationsHistory[state.revision] = transformedOps;
    state.processedMessageIds.add(messageId);

    // 4. 持久化 Changeset
    await this.changesetRepo.save({
      datasheetId,
      revision: state.revision,
      operations: transformedOps,
      userId,
      messageId,
      createdAt: Date.now(),
    });

    // 5. 更新内存快照（按需生成持久化快照）
    if (state.revision % SNAPSHOT_INTERVAL === 0) {
      await this.snapshotService.saveSnapshot(datasheetId, state.revision, newSnapshot);
    }

    return { transformedOps, revision: state.revision };
  }
}
```

### 2.4 同一单元格并发编辑处理

APITable 处理同一单元格并发编辑采用 **Last-Write-Wins（后写覆盖）** 策略：

```
场景：Alice 和 Bob 同时编辑单元格 C2

1. Alice 将 C2 设为 "Hello"，baseRevision = 100
2. Bob 将 C2 设为 "World"，baseRevision = 100

3. Alice 的操作先到达服务器：
   - Transform: 无冲突（baseRevision = currentRevision）
   - 服务器应用：C2 = "Hello"，revision = 101
   - ACK Alice，广播给 Bob

4. Bob 的操作到达服务器（baseRevision = 100, currentRevision = 101）：
   - Transform: Bob 的操作 vs Alice 的操作
   - JSON0 Transform 对于相同 path 的 od+oi（替换）：
     → Alice 的操作被 Transform 为：先删除 "Hello" 再插入 "World"
     → Bob 的操作变为：先删除 Alice 写入的 "Hello"，再写入 "World"
   - 服务器应用后：C2 = "World"，revision = 102
   - 结果：Bob 的编辑覆盖了 Alice 的

5. Alice 端收到广播：
   - Alice 本地已经显示 "Hello"
   - 收到 Bob 的操作，Transform 后：删除 "Hello"，写入 "World"
   - Alice 看到 C2 变为 "World"
```

---

## 3. 多用户光标与感知协议

### 3.1 光标位置数据结构设计

多维表格中的"光标"概念比纯文本编辑器更复杂，需要表示当前选中的单元格、选区范围等。

```typescript
interface CursorPosition {
  userId: string;           // 用户 ID
  userName: string;         // 用户显示名
  userColor: string;        // 用户标识颜色（如 "#FF5733"）
  datasheetId: string;      // 当前所在数据表 ID
  viewId: string;           // 当前所在视图 ID

  // 选区信息
  selection: {
    type: 'cell' | 'range' | 'row' | 'column' | 'none';
    // 单元格选择
    cell?: {
      fieldId: string;      // 字段 ID
      recordId: string;     // 记录 ID
    };
    // 范围选择
    range?: {
      startFieldId: string;
      startRecordIndex: number;
      endFieldId: string;
      endRecordIndex: number;
    };
    // 行选择
    rowIndices?: number[];
    // 列选择
    fieldIds?: string[];
  };

  timestamp: number;        // 最后更新时间
}

// 示例：用户选中了 C2:D5 范围
const cursor: CursorPosition = {
  userId: 'user_abc',
  userName: '张三',
  userColor: '#FF5733',
  datasheetId: 'dstXXXXX',
  viewId: 'viwYYYYY',
  selection: {
    type: 'range',
    range: {
      startFieldId: 'fldCCC',
      startRecordIndex: 1,
      endFieldId: 'fldDDD',
      endRecordIndex: 4,
    }
  },
  timestamp: Date.now(),
};
```

### 3.2 Awareness 协议

参考 Yjs 的 Awareness 协议设计，Awareness 状态用于广播"谁在哪里"的信息：

```
┌─────────────────────────────────────────────────────┐
│                Awareness 协议设计                    │
├─────────────────────────────────────────────────────┤
│                                                     │
│  客户端本地状态：                                    │
│    { userId, selection, userName, color }            │
│                                                     │
│  状态变更触发：                                      │
│    - 用户点击/选择单元格 → 更新 selection            │
│    - 用户切换视图 → 更新 viewId                      │
│    - 用户切换数据表 → 更新 datasheetId               │
│                                                     │
│  广播策略：                                          │
│    - 节流（Throttle）：每 100-300ms 最多广播一次     │
│    - 仅在有变更时广播                                │
│    - 不通过 OT Transform，直接覆盖旧状态             │
│                                                     │
│  服务端维护：                                        │
│    awarenessStates: Map<datasheetId, Map<userId, CursorPosition>>
│                                                     │
│  新用户加入时：                                      │
│    服务端发送当前所有在线用户的 awarenessStates       │
│                                                     │
│  用户离开/超时时：                                   │
│    广播离开事件，其他端移除该用户的光标              │
│                                                     │
└─────────────────────────────────────────────────────┘
```

```typescript
// Awareness 服务端实现（NestJS）
@WebSocketGateway()
export class AwarenessGateway {
  // datasheetId → userId → cursor
  private awarenessMap: Map<string, Map<string, CursorPosition>> = new Map();

  @SubscribeMessage('cursor:update')
  handleCursorUpdate(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: CursorPosition,
  ) {
    const { datasheetId, userId } = data;
    if (!this.awarenessMap.has(datasheetId)) {
      this.awarenessMap.set(datasheetId, new Map());
    }
    this.awarenessMap.get(datasheetId)!.set(userId, data);

    // 广播给同数据表的其他用户
    client.to(`datasheet:${datasheetId}`).emit('cursor:broadcast', data);
  }
}
```

### 3.3 选区的 Transform

当其他用户执行了插入/删除行列的操作时，本地显示的远程用户选区也需要相应调整：

```typescript
function transformSelection(
  selection: CursorPosition['selection'],
  op: TableOp,
): CursorPosition['selection'] {
  switch (op.type) {
    case OpType.InsertRow: {
      const insertIndex = op.coord.rowIndex;
      if (selection.type === 'range') {
        let { startRecordIndex, endRecordIndex } = selection.range;
        if (insertIndex <= startRecordIndex) startRecordIndex++;
        if (insertIndex <= endRecordIndex) endRecordIndex++;
        return { ...selection, range: { ...selection.range, startRecordIndex, endRecordIndex } };
      }
      return selection;
    }
    case OpType.DeleteRow: {
      const deleteIndex = op.coord.rowIndex;
      if (selection.type === 'range') {
        let { startRecordIndex, endRecordIndex } = selection.range;
        if (deleteIndex < startRecordIndex) startRecordIndex--;
        if (deleteIndex < endRecordIndex) endRecordIndex--;
        return { ...selection, range: { ...selection.range, startRecordIndex, endRecordIndex } };
      }
      return selection;
    }
    case OpType.InsertField:
    case OpType.DeleteField:
      // 字段以 ID 标识，插入/删除不影响其他字段的 ID
      return selection;
    default:
      return selection;
  }
}
```

---

## 4. WebSocket 协议设计

### 4.1 消息格式

采用 JSON 格式（与 APITable 一致），后续可考虑切换到 MessagePack 二进制格式优化性能。

```typescript
// 基础消息封装
interface WsMessage<T = any> {
  type: WsMessageType;     // 消息类型
  datasheetId: string;     // 目标数据表 ID
  payload: T;              // 消息体
  messageId: string;       // 消息唯一 ID（UUID）
  timestamp: number;       // 时间戳
}

// 消息类型枚举
enum WsMessageType {
  // 操作相关
  Op = 'op',               // 客户端发送操作
  Ack = 'ack',             // 服务器确认操作
  Rej = 'rej',             // 服务器拒绝操作
  Broadcast = 'broadcast', // 服务器广播操作

  // 同步相关
  Sync = 'sync',           // 全量同步请求
  SyncResp = 'syncResp',   // 全量同步响应
  FetchMiss = 'fetchMiss', // 拉取缺失操作
  FetchMissResp = 'fetchMissResp', // 拉取响应

  // 光标/感知
  Cursor = 'cursor',       // 光标更新
  CursorBroadcast = 'cursorBroadcast', // 光标广播

  // 连接管理
  Join = 'join',           // 加入数据表房间
  Leave = 'leave',         // 离开数据表房间
  Presence = 'presence',   // 在线用户列表

  // 心跳
  Heartbeat = 'heartbeat', // 心跳 ping
  HeartbeatAck = 'heartbeatAck', // 心跳 pong
}
```

### 4.2 各消息类型详细格式

#### 操作消息 (Op)

```typescript
// 客户端 → 服务器：发送操作
interface OpPayload {
  operations: Json0Op[];     // JSON0 操作列表
  baseRevision: number;      // 基于的版本号
  // 服务器处理后会返回 ack
}

// 示例
{
  type: 'op',
  datasheetId: 'dstXXXXX',
  messageId: 'msg-uuid-001',
  payload: {
    operations: [
      { p: ['recordMap', 'recABC', 'fields', 'fldXYZ'], od: '旧值', oi: '新值' }
    ],
    baseRevision: 42
  }
}
```

#### 确认消息 (Ack)

```typescript
// 服务器 → 客户端：确认操作已处理
interface AckPayload {
  revision: number;         // 服务器当前版本号
  messageId: string;        // 对应的客户端消息 ID
}

// 拒绝消息
interface RejPayload {
  messageId: string;
  reason: string;           // 拒绝原因：版本冲突、权限不足等
  currentRevision: number;  // 服务器当前版本号
}
```

#### 广播消息 (Broadcast)

```typescript
// 服务器 → 其他客户端：广播 Transform 后的操作
interface BroadcastPayload {
  operations: Json0Op[];     // Transform 后的操作
  revision: number;          // 版本号
  userId: string;            // 操作发起者
}
```

#### 同步消息 (Sync)

```typescript
// 客户端 → 服务器：请求同步
interface SyncPayload {
  localRevision: number;     // 客户端当前版本号
}

// 服务器 → 客户端：同步响应
interface SyncRespPayload {
  currentRevision: number;
  operations: { revision: number; ops: Json0Op[] }[]; // 版本号 → 操作
  snapshot?: SnapshotData;   // 如果差距太大，直接返回快照
}
```

#### 拉取缺失操作 (FetchMiss)

```typescript
// 客户端 → 服务器：拉取 [from, to] 之间的缺失操作
interface FetchMissPayload {
  fromRevision: number;
  toRevision: number;
}

// 服务器 → 客户端
interface FetchMissRespPayload {
  operations: { revision: number; ops: Json0Op[] }[];
}
```

### 4.3 连接管理

```typescript
// 加入数据表房间
interface JoinPayload {
  datasheetId: string;
  viewId?: string;
  token: string;             // JWT 认证 token
}

// 在线用户列表
interface PresencePayload {
  users: Array<{
    userId: string;
    userName: string;
    userColor: string;
    lastActive: number;
  }>;
}
```

#### 认证流程

```
1. 客户端发起 WebSocket 连接，携带 JWT token
2. 服务端验证 token，提取 userId
3. 连接建立后，客户端发送 join 消息进入数据表房间
4. 服务端验证用户对该数据表的权限
5. 返回当前数据表状态 + 在线用户列表

如果认证失败：
  → 服务端返回错误并断开连接
  → 客户端使用刷新后的 token 重试
```

#### 心跳机制

```typescript
// 心跳配置
const HEARTBEAT_CONFIG = {
  interval: 30000,     // 30 秒发送一次心跳
  timeout: 10000,      // 10 秒无响应视为断连
  maxRetries: 3,       // 最大重试次数
};

// 心跳消息
{ type: 'heartbeat', datasheetId: '', messageId: 'hb-001', payload: {} }
{ type: 'heartbeatAck', datasheetId: '', messageId: 'hb-001', payload: {} }
```

#### 断线重连

```typescript
class ReconnectionManager {
  private retryCount = 0;
  private maxRetries = 10;
  private baseDelay = 1000;    // 初始延迟 1 秒
  private maxDelay = 30000;    // 最大延迟 30 秒

  getReconnectDelay(): number {
    // 指数退避 + 随机抖动
    const delay = Math.min(
      this.baseDelay * Math.pow(2, this.retryCount),
      this.maxDelay
    );
    const jitter = delay * 0.1 * Math.random();
    return delay + jitter;
  }

  async reconnect(): Promise<void> {
    if (this.retryCount >= this.maxRetries) {
      // 转入离线模式
      this.enterOfflineMode();
      return;
    }
    this.retryCount++;
    const delay = this.getReconnectDelay();
    await sleep(delay);
    await this.establishConnection();
  }
}
```

### 4.4 操作确认机制

客户端采用**乐观执行 + 服务端确认/拒绝**模式：

```
┌────────────────────────────────────────────────────────────┐
│               操作确认流程                                   │
├────────────────────────────────────────────────────────────┤
│                                                            │
│  Client                              Server                │
│    │                                    │                   │
│    │  1. 用户编辑 → 生成 op             │                   │
│    │  2. 立即应用到本地（乐观执行）     │                   │
│    │  3. 放入 "未确认" 队列             │                   │
│    │  4. 发送 op ──────────────────→    │                   │
│    │                                    │ 5. Transform      │
│    │                                    │ 6. 应用到服务端   │
│    │                                    │ 7. 持久化         │
│    │     ←──────────── ACK(revision)    │                   │
│    │  8. 从 "未确认" 队列移除           │                   │
│    │  9. 更新本地 revision              │ 10. 广播给其他人  │
│    │                                    │                   │
│    │  如果收到 REJ：                    │                   │
│    │  → 回滚本地操作                    │                   │
│    │  → 从服务器拉取最新状态            │                   │
│    │  → 重新应用本地未确认操作          │                   │
│    │                                    │                   │
└────────────────────────────────────────────────────────────┘
```

---

## 5. 离线编辑与冲突解决

### 5.1 客户端操作队列

```typescript
class OtClient {
  private revision = 0;                         // 已确认的服务端版本号
  private pendingOps: Json0Op[][] = [];         // 未确认的操作队列
  private sentOp: { ops: Json0Op[]; messageId: string } | null = null;
  private bufferOps: Json0Op[][] = [];          // 等待发送的操作缓冲

  // 状态机
  private state: ClientState = ClientState.Synced;

  /**
   * 用户本地编辑
   * 1. 立即应用到本地文档
   * 2. 根据当前状态决定发送或缓冲
   */
  applyLocalEdit(operations: Json0Op[]): void {
    // 立即应用到本地文档
    this.localDoc = json0.apply(this.localDoc, operations);

    switch (this.state) {
      case ClientState.Synced:
        // 无未确认操作，直接发送
        this.sendOp(operations);
        this.state = ClientState.Awaiting;
        break;

      case ClientState.Awaiting:
        // 有操作正在等待确认，缓冲
        this.bufferOps.push(operations);
        this.state = ClientState.AwaitingWithBuffer;
        break;

      case ClientState.AwaitingWithBuffer:
        // 继续缓冲
        this.bufferOps.push(operations);
        break;

      case ClientState.Offline:
        // 离线模式，仅缓冲
        this.bufferOps.push(operations);
        break;
    }
  }

  private sendOp(ops: Json0Op[]): void {
    const messageId = uuid();
    this.sentOp = { ops, messageId };
    this.ws.send({
      type: 'op',
      datasheetId: this.datasheetId,
      messageId,
      payload: { operations: ops, baseRevision: this.revision },
    });
  }
}
```

### 5.2 客户端状态机

```
                    ┌──────────┐
         ┌────────→ │  Synced  │ ←──────────────┐
         |          └────┬─────┘                 |
         |               | 本地编辑               | ACK（无缓冲）
         |               ↓                        |
         |          ┌──────────────┐              |
         |          │   Awaiting   │ ─────────────┘
         |          └────┬───┬─────┘
         |               |   | 本地编辑
         |     ACK(无缓冲)|   ↓
         |               | ┌───────────────────────┐
         |               └→│ AwaitingWithBuffer    │←── 本地编辑
         |                 └────┬──────────────────┘
         |                      |
         |          ACK(有缓冲) | 发送缓冲中的操作
         |                      ↓
         |                 ┌──────────────┐
         |                 │   Awaiting   │ (发送了缓冲中组合后的操作)
         |                 └──────────────┘
         |
    网络断开    ┌──────────────┐
         └──────│   Offline    │
                └──────┬───────┘
                       | 网络恢复
                       ↓
                  ┌──────────┐
                  | FetchMiss | → 拉取缺失操作 → Transform → 回到 Synced/Awaiting
                  └──────────┘
```

### 5.3 重连后的同步流程

```
┌─────────────────────────────────────────────────────────────┐
│               断线重连同步流程                                │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  1. WebSocket 重新连接                                      │
│     → 发送 join 消息，附带 JWT token                        │
│     → 服务端验证后返回当前 revision                          │
│                                                             │
│  2. 判断版本差距                                             │
│     if (serverRevision - localRevision > THRESHOLD) {       │
│       // 差距过大，直接拉取最新快照                           │
│       请求最新 snapshot                                      │
│       将本地未确认操作 Transform 到新 snapshot 上            │
│     } else {                                                │
│       // 差距可接受，拉取缺失的操作                          │
│       fetchMiss(localRevision, serverRevision)              │
│     }                                                       │
│                                                             │
│  3. 处理缺失操作                                             │
│     for op in missedOperations:                             │
│       if sentOp:                                            │
│         [sentOp', op'] = transform(sentOp, op)              │
│         sentOp = sentOp'                                    │
│       for buf in bufferOps:                                 │
│         [buf', op'] = transform(buf, op)                    │
│         buf = buf'                                          │
│       localDoc = apply(localDoc, op')                       │
│                                                             │
│  4. 重发未确认操作                                           │
│     if sentOp:                                              │
│       重新发送 sentOp（baseRevision 已更新）                 │
│     if bufferOps.length > 0:                                │
│       组合所有缓冲操作为一个操作                              │
│       发送组合操作                                           │
│                                                             │
│  5. 恢复正常状态                                             │
│     revision = serverRevision                               │
│     state = Synced 或 Awaiting                              │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 5.4 长时间离线的处理策略

```typescript
class OfflineHandler {
  private readonly MAX_OFFLINE_OPS = 500;     // 最大离线操作数
  private readonly MAX_OFFLINE_TIME = 24 * 3600 * 1000; // 24 小时

  async handleReconnect(
    localRevision: number,
    serverRevision: number,
    offlineDuration: number,
  ): Promise<SyncStrategy> {
    const versionGap = serverRevision - localRevision;

    // 策略1：版本差距小，直接拉取操作
    if (versionGap <= 50) {
      return { type: 'fetchMiss', from: localRevision, to: serverRevision };
    }

    // 策略2：版本差距中等，拉取快照 + 少量操作
    if (versionGap <= 500) {
      const snapshot = await this.fetchNearestSnapshot(serverRevision);
      return {
        type: 'snapshotPlusOps',
        snapshot,
        from: snapshot.revision,
        to: serverRevision,
      };
    }

    // 策略3：版本差距大或离线时间过长
    if (versionGap > 500 || offlineDuration > this.MAX_OFFLINE_TIME) {
      // 全量同步 + 冲突检测
      return {
        type: 'fullSync',
        mergeStrategy: 'manual', // 需要用户手动解决冲突
      };
    }

    return { type: 'fetchMiss', from: localRevision, to: serverRevision };
  }
}
```

### 5.5 冲突可视化

当自动合并无法完美处理时，需要通知用户：

```typescript
interface ConflictInfo {
  type: 'cell-overwrite' | 'row-deleted' | 'field-deleted' | 'view-deleted';
  description: string;
  localChange: Json0Op;
  remoteChange: Json0Op;
  resolution: 'merged' | 'yours' | 'theirs' | 'manual';
  affectedCells: Array<{
    recordId: string;
    fieldId: string;
    localValue: any;
    remoteValue: any;
    mergedValue: any;
  }>;
}

// 冲突通知 UI
class ConflictNotification {
  showConflict(info: ConflictInfo): void {
    if (info.type === 'cell-overwrite') {
      // 显示 toast："你的编辑已被张三的编辑合并"
      // 可选：点击查看详情
    }
    if (info.type === 'row-deleted') {
      // 显示警告："你正在编辑的行已被张三删除"
      // 提供：恢复行 / 放弃编辑 选项
    }
    if (info.type === 'field-deleted') {
      // 显示警告："你正在编辑的字段已被张三删除"
      // 提供：恢复字段 / 放弃编辑 选项
    }
  }
}
```

---

## 6. 服务端架构

### 6.1 OT Server 在 NestJS 中的模块设计

```
┌─────────────────────────────────────────────────────────────┐
│                    NestJS OT Module 架构                     │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  OtModule                                                   │
│  ├── OtGateway (WebSocket 网关)                              │
│  │   ├── @SubscribeMessage('op')     接收操作               │
│  │   ├── @SubscribeMessage('join')   加入房间               │
│  │   ├── @SubscribeMessage('leave')  离开房间               │
│  │   ├── @SubscribeMessage('cursor') 光标更新               │
│  │   └── @SubscribeMessage('sync')   同步请求               │
│  │                                                           │
│  ├── OtService (OT 核心逻辑)                                 │
│  │   ├── handleOperation()           处理操作               │
│  │   ├── transformAndApply()         Transform + 应用      │
│  │   ├── broadcastOperation()        广播操作               │
│  │   └── getMissedOperations()       获取缺失操作          │
│  │                                                           │
│  ├── ChangesetService (操作持久化)                           │
│  │   ├── saveChangeset()             保存 Changeset         │
│  │   ├── getChangesets()             查询 Changeset 列表    │
│  │   └── getChangesetsByRange()      按版本范围查询         │
│  │                                                           │
│  ├── SnapshotService (快照管理)                              │
│  │   ├── generateSnapshot()          生成快照               │
│  │   ├── getLatestSnapshot()         获取最近快照           │
│  │   └── getSnapshotByRevision()     按版本获取快照         │
│  │                                                           │
│  ├── PresenceService (在线状态管理)                          │
│  │   ├── userJoined()                用户加入               │
│  │   ├── userLeft()                  用户离开               │
│  │   └── getOnlineUsers()            获取在线列表           │
│  │                                                           │
│  └── OtGuard (权限守卫)                                      │
│      ├── validateToken()             验证 JWT               │
│      └── checkPermission()           检查数据表权限         │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

```typescript
// ot.module.ts
@Module({
  imports: [
    TypeOrmModule.forFeature([ChangesetEntity, SnapshotEntity]),
    RedisModule,   // 用于分布式锁和缓存
    AuthModule,    // 权限验证
  ],
  controllers: [],
  providers: [
    OtService,
    OtGateway,
    ChangesetService,
    SnapshotService,
    PresenceService,
  ],
  exports: [OtService],
})
export class OtModule {}
```

### 6.2 操作日志（Operation Log）持久化

```sql
-- 操作日志表
CREATE TABLE changesets (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  datasheet_id    UUID NOT NULL REFERENCES datasheets(id),
  revision        INTEGER NOT NULL,
  operations      JSONB NOT NULL,          -- JSON0 操作数组
  user_id         UUID NOT NULL REFERENCES users(id),
  message_id      VARCHAR(64) NOT NULL,    -- 客户端消息 ID（去重用）
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (datasheet_id, revision),         -- 每个数据表的版本号唯一
  UNIQUE (datasheet_id, message_id)        -- 消息去重
);

-- 按数据表和版本范围查询的索引
CREATE INDEX idx_changesets_datasheet_revision
  ON changesets (datasheet_id, revision);

-- 按时间查询（用于清理历史）
CREATE INDEX idx_changesets_created_at
  ON changesets (created_at);
```

```typescript
@Injectable()
export class ChangesetService {
  constructor(
    @InjectRepository(ChangesetEntity)
    private readonly repo: Repository<ChangesetEntity>,
  ) {}

  async saveChangeset(data: {
    datasheetId: string;
    revision: number;
    operations: Json0Op[];
    userId: string;
    messageId: string;
  }): Promise<void> {
    await this.repo.save({
      datasheetId: data.datasheetId,
      revision: data.revision,
      operations: data.operations,
      userId: data.userId,
      messageId: data.messageId,
    });
  }

  async getChangesetsByRange(
    datasheetId: string,
    fromRevision: number,
    toRevision: number,
  ): Promise<ChangesetEntity[]> {
    return this.repo.find({
      where: {
        datasheetId,
        revision: Between(fromRevision, toRevision),
      },
      order: { revision: 'ASC' },
    });
  }

  async getLatestRevision(datasheetId: string): Promise<number> {
    const result = await this.repo
      .createQueryBuilder('c')
      .select('MAX(c.revision)', 'maxRev')
      .where('c.datasheetId = :datasheetId', { datasheetId })
      .getRawOne();
    return result?.maxRev ?? 0;
  }
}
```

### 6.3 快照（Snapshot）与操作日志的配合

```
┌─────────────────────────────────────────────────────────────┐
│              快照 + 操作日志 配合策略                        │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  时间轴：                                                   │
│  ──────────────────────────────────────────────────────→    │
│  Snapshot(r=0)   ops...  Snapshot(r=100)  ops...  当前      │
│  │               │       │               │       r=157     │
│  │◄──────────────►│       │◄──────────────►│               │
│     100 个操作            57 个操作                         │
│                                                             │
│  快照间隔策略：                                              │
│  - 固定间隔：每 100 个 revision 生成一次快照                 │
│  - 时间间隔：每 5 分钟生成一次（针对低频编辑的数据表）       │
│  - 混合策略：min(100 ops, 5 min) 触发快照                   │
│                                                             │
│  服务器内存模型：                                            │
│  DatasheetState {                                            │
│    snapshot: JSON         // 最近快照（内存中）              │
│    revision: number       // 当前版本号                     │
│    opsHistory: Json0Op[]  // 快照之后的操作历史（内存中）    │
│  }                                                          │
│                                                             │
│  新用户加入 / 重连同步：                                     │
│  if (gap <= 50):                                            │
│    发送 opsHistory[lastSnapshotRev..current]                │
│  elif (gap <= 500):                                         │
│    发送 snapshot + opsHistory                               │
│  else:                                                      │
│    从数据库加载最新 snapshot + 增量 ops                     │
│                                                             │
│  快照压缩：                                                  │
│  - 生成新快照后，旧快照的操作日志可归档到冷存储              │
│  - 保留最近 N 个快照 + 操作日志在热存储中                   │
│  - 操作日志超过保留期后，从数据库中归档或删除                │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

```sql
-- 快照表
CREATE TABLE snapshots (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  datasheet_id    UUID NOT NULL REFERENCES datasheets(id),
  revision        INTEGER NOT NULL,
  data            JSONB NOT NULL,          -- 完整数据快照
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (datasheet_id, revision)
);

CREATE INDEX idx_snapshots_datasheet_revision
  ON snapshots (datasheet_id, revision DESC);
```

```typescript
@Injectable()
export class SnapshotService {
  private readonly SNAPSHOT_INTERVAL = 100; // 每 100 个 revision

  constructor(
    @InjectRepository(SnapshotEntity)
    private readonly snapshotRepo: Repository<SnapshotEntity>,
    private readonly changesetService: ChangesetService,
  ) {}

  async generateSnapshot(datasheetId: string, revision: number, data: any): Promise<void> {
    await this.snapshotRepo.save({
      datasheetId,
      revision,
      data,
    });
  }

  async shouldGenerateSnapshot(datasheetId: string, currentRevision: number): Promise<boolean> {
    const lastSnapshot = await this.snapshotRepo.findOne({
      where: { datasheetId },
      order: { revision: 'DESC' },
    });
    if (!lastSnapshot) return true;
    return (currentRevision - lastSnapshot.revision) >= this.SNAPSHOT_INTERVAL;
  }

  /**
   * 重建指定 revision 的快照
   * 找到最近快照 + 重放操作
   */
  async reconstructSnapshot(datasheetId: string, targetRevision: number): Promise<any> {
    // 找到 <= targetRevision 的最近快照
    const snapshot = await this.snapshotRepo.findOne({
      where: { datasheetId, revision: LessThanOrEqual(targetRevision) },
      order: { revision: 'DESC' },
    });

    if (!snapshot) {
      throw new Error(`No snapshot found for ${datasheetId}`);
    }

    // 从快照开始重放操作
    let data = snapshot.data;
    const changesets = await this.changesetService.getChangesetsByRange(
      datasheetId,
      snapshot.revision + 1,
      targetRevision,
    );

    for (const cs of changesets) {
      data = json0.apply(data, cs.operations);
    }

    return data;
  }
}
```

### 6.4 并发控制：操作序列化策略

```
┌─────────────────────────────────────────────────────────────┐
│                 并发控制策略                                  │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  核心原则：同一数据表的操作必须序列化处理                     │
│                                                             │
│  方案1：进程内锁（单实例部署）                               │
│  ──────────────────────                                     │
│  private locks: Map<string, Promise<void>> = new Map();     │
│                                                             │
│  async handleOperation(datasheetId, ...) {                  │
│    // 等待该数据表的上一个操作处理完成                       │
│    while (this.locks.has(datasheetId)) {                    │
│      await this.locks.get(datasheetId);                     │
│    }                                                        │
│    const promise = this._processOp(datasheetId, ...);       │
│    this.locks.set(datasheetId, promise);                    │
│    try { return await promise; }                            │
│    finally { this.locks.delete(datasheetId); }              │
│  }                                                          │
│                                                             │
│  方案2：Redis 分布式锁（多实例部署）                         │
│  ──────────────────────                                     │
│  async handleOperation(datasheetId, ...) {                  │
│    const lockKey = `ot:lock:${datasheetId}`;                │
│    const lock = await this.redisLock.acquire(lockKey, 5000);│
│    try {                                                     │
│      return await this._processOp(datasheetId, ...);        │
│    } finally {                                               │
│      await lock.release();                                   │
│    }                                                        │
│  }                                                          │
│                                                             │
│  方案3：消息队列（高吞吐场景）                               │
│  ──────────────────────                                     │
│  每个数据表一个队列分区（Kafka partition / Redis Stream）    │
│  消费者按分区顺序消费，保证同一数据表的操作序列化            │
│  适用于 10k+ 并发编辑者的大规模场景                         │
│                                                             │
│  推荐：                                                      │
│  - 初期（单实例）：方案1 进程内锁                            │
│  - 中期（多实例）：方案2 Redis 分布式锁                      │
│  - 后期（大规模）：方案3 消息队列                            │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 6.5 完整 OT Server 处理时序图

```
  Client A          OT Gateway         OtService         ChangesetService      SnapshotService      Client B
     |                   |                  |                    |                     |                 |
     |  1. send op       |                  |                    |                     |                 |
     |  (baseRev=42)     |                  |                    |                     |                 |
     |──────────────────→|                  |                    |                     |                 |
     |                   | 2. validate      |                    |                     |                 |
     |                   |   & acquire lock |                    |                     |                 |
     |                   |─────────────────→|                    |                     |                 |
     |                   |                  | 3. Transform       |                     |                 |
     |                   |                  |   against history  |                     |                 |
     |                   |                  |   (rev 42→50)      |                     |                 |
     |                   |                  |                    |                     |                 |
     |                   |                  | 4. Apply to state  |                     |                 |
     |                   |                  |   revision=51      |                     |                 |
     |                   |                  |                    |                     |                 |
     |                   |                  | 5. Save changeset  |                     |                 |
     |                   |                  |───────────────────→|                     |                 |
     |                   |                  |                    | 6. Check snapshot   |                 |
     |                   |                  |                    |────────────────────→|                 |
     |                   |                  |                    |                     |                 |
     |  ←── ACK(rev=51)  |                  |                    |                     |                 |
     |                   |←─────────────────|                    |                     |                 |
     |                   |                  |                    |                     |                 |
     |                   |  7. Broadcast    |                    |                     |                 |
     |                   |←─────────────────|                    |                     |                 |
     |                   |──────────────────────────────────────────────────────────────────────────→|
     |                   |                  |                    |                     |   8. Transform
     |                   |                  |                    |                     |   & Apply
     |                   |                  |                    |                     |                 |
```

---

## 总结与建议

### 实施优先级

| 阶段 | 内容 | 优先级 |
|------|------|--------|
| MVP | 基础 OT（单服务端进程内锁 + JSON0 Transform + WebSocket） | P0 |
| MVP | 操作确认机制（客户端状态机 + ACK/REJ） | P0 |
| V1 | 光标感知（Awareness 协议） | P1 |
| V1 | 快照 + 操作日志持久化 | P1 |
| V1 | 断线重连 + FetchMiss | P1 |
| V2 | 离线编辑（IndexedDB 缓存 + 重连同步） | P2 |
| V2 | 冲突可视化 | P2 |
| V2 | 操作合并与压缩 | P2 |
| V3 | Redis 分布式锁（多实例部署） | P3 |
| V3 | Undo/Redo 的 OT 感知 | P3 |

### 关键技术决策

1. **采用 JSON0 作为底层 OT 类型**（与 APITable 一致），在 JSON0 之上构建表格语义操作
2. **客户端等待 ACK 后再发送下一个操作**（Google Wave 模式），简化服务端实现
3. **同一单元格冲突采用 Last-Write-Wins 策略**，简单可靠
4. **使用字段 ID 而非列索引定位**，避免大量列插入/删除导致的 Transform 复杂度
5. **快照间隔 100 个 revision**，平衡存储成本和恢复速度

---

## 参考链接

### OT 算法基础
- [Google Wave OT 白皮书](https://svn.apache.org/repos/asf/incubator/wave/whitepapers/operational-transform/operational-transform.html) — Google Wave 对 OT 的扩展理论，客户端 ACK 机制的设计来源
- [Operational Transformation - Wikipedia](https://en.wikipedia.org/wiki/Operational_transformation) — OT 算法的历史和理论基础
- [OT 算法及 Univer 协同编辑设计](https://docs.univer.ai/blog/ot) — Univer 团队的 OT 实践分享，电子表格协同编辑的完整设计
- [How to Implement Operational Transformation](https://oneuptime.com/blog/post/2026-01-30-operational-transformation/view) — OT 实现教程，含完整代码示例
- [My Experience Implementing OT From Scratch](https://dev.to/knemerzitski/my-experience-implementing-operational-transformation-ot-from-scratch-27pd) — 从零实现 OT 的经验分享
- [Practical Intro to Operational Transformation](https://archive.casouri.cc/note/2025/practical-intro-ot/) — OT 算法的实践介绍

### Jupiter 算法
- [Jupiter Made Abstract, and Then Refined (PDF)](https://hengxin.github.io/papers/2020-JCST-Jupiter.pdf) — Jupiter 算法的抽象与精化
- [High-latency, low-bandwidth windowing in the Jupiter collaboration system](https://dl.acm.org/doi/10.1145/215585.215706) — Jupiter 系统原始论文（1995）

### APITable 相关
- [APITable GitHub 仓库](https://github.com/apitable/apitable) — APITable 开源多维表格项目
- [APITable OT JSON 文档](https://apitable.getoutline.com/s/751b142b-866f-4174-a5f1-a2975f85ad41/doc/0x7-operational-transformation-and-ot-json-wCPYeJ1jWy) — APITable 的 OT 和 JSON0 技术文档
- [APITable Gitee 镜像](https://gitee.com/lh.com/APITable) — APITable Gitee 镜像

### JSON0 / ShareDB
- [ottypes/json0](https://github.com/ottypes/json0) — JSON0 OT 类型实现，APITable 的 OT 底层算法
- [ShareDB](https://github.com/share/sharedb) — 基于 OT 的实时数据库后端
- [ShareDB OT Types 文档](https://share.github.io/sharedb/types/) — ShareDB 的 OT 类型系统
- [Simultaneous Editing of JSON Objects via OT (ACM)](https://dl.acm.org/doi/pdf/10.1145/2851613.2852003) — JSON 对象 OT 操作的学术论文

### 中文参考资料
- [多人协同编辑算法——OT 算法](https://juejin.cn/post/7475539523993567267) — 掘金 OT 算法详解
- [协作同步：OT 和 CRDT 详解](https://zhuanlan.zhihu.com/p/616794280) — 知乎 OT/CRDT 对比
- [初探富文本之 OT 协同算法](https://blog.csdn.net/qq_40413670/article/details/128606311) — CSDN OT 算法分析
- [文档协同编辑中的 OT 算法原理解析](https://www.foxfire.com.cn/article/1236.html) — OT 算法原理深度解析
- [深度解析 OT 操作转换算法](https://www.grapecity.com.cn/blogs/Technical-Essence-In-depth-Analysis-of-OT) — SpreadJS 团队的 OT 深度分析
- [浅谈在线文档的那些事儿](https://zhuean.cn/p/481370601) — 在线文档 OT 实现分享
- [OT 算法在 OA 协同编辑中的性能优化研究](https://my.oschina.net/emacs_8003139/blog/19471493) — OT 性能优化

### 感知协议 / 光标
- [Yjs Awareness 协议](https://docs.yjs.dev/getting-started/adding-awareness) — Yjs 的 Awareness 功能文档
- [Yjs Fundamentals: Sync & Awareness](https://medium.com/dovetail-engineering/yjs-fundamentals-part-2-sync-awareness-73b8fabc2233) — Yjs 同步与感知机制
- [Tiptap Awareness 文档](https://tiptap.dev/docs/collaboration/core-concepts/awareness) — Tiptap 协作的感知机制

### OT 可视化与工具
- [OT 可视化演示](https://operational-transformation.github.io/) — OT 算法的交互式可视化
- [awesome-ot](https://github.com/turkyden/awesome-ot) — OT 相关资源汇总
- [ot.js](https://github.com/Operational-Transformation/ot.js) — 浏览器端 OT 库

### WebSocket 协议
- [Collaborative Editor System Design](https://crackingwalnuts.com/post/collaborative-editor-system-design) — 协同编辑系统设计
- [How Google Docs Uses OT for Real-Time Collaboration](https://dev.to/dhanush___b/how-google-docs-uses-operational-transformation-for-real-time-collaboration-119) — Google Docs OT 实践
- [What's different about the new Google Docs](https://drive.googleblog.com/2010/09/whats-different-about-new-google-docs.html) — Google Docs 官方博客：OT 与协作协议
