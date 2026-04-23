# 自动化引擎实现深度研究

## 概述
本文档深入研究多维表格产品的自动化工作流引擎实现方案，涵盖执行引擎设计、任务调度、错误处理与重试、脚本沙箱、数据变更触发和 Temporal 对比。基于已确定的技术栈（NestJS + PostgreSQL + Redis）。

---

## 一、工作流执行引擎设计（参考 n8n 源码架构）

### 1.1 n8n 核心架构分析

n8n 的核心执行引擎位于 `packages/core/src/execution-engine/`，关键模块：

**核心类：`WorkflowExecute`**
- 工作流以 `PCancelable<IRun>` 形式执行，支持运行中取消
- 执行流程：创建执行栈 `nodeExecutionStack` → 逐节点处理 `processRunExecutionData`
- 支持完整执行和部分执行（Partial Execution）

**DAG 图结构：`DirectedGraph`**

```typescript
export class DirectedGraph {
  private nodes: Map<string, INode> = new Map();
  private connections: Map<DirectedGraphKey, GraphConnection> = new Map();

  static fromWorkflow(workflow: Workflow): DirectedGraph
  toWorkflow(params): Workflow

  addNode(node), removeNode(node, options)
  addConnection({ from, to, type, outputIndex, inputIndex })
  getDirectChildConnections(node)
  getChildrenRecursive(node, children)
}
```

- 使用邻接表存储，键格式 `fromName-outputType-outputIndex-inputIndex-toName`
- 支持子图查找 `findSubgraph()`、环检测 `handleCycles()`、拓扑排序执行

**部分执行算法流程**：
1. `findTriggerForPartialExecution` — 找到触发器
2. `findSubgraph` — 提取目标节点的子图
3. `findStartNodes` — 找到执行起点
4. `handleCycles` — 检测并处理环
5. `cleanRunData` — 清理运行数据
6. `recreateNodeExecutionStack` — 重建执行栈
7. 执行

### 1.2 自研引擎建议

```
工作流定义（JSON格式）:
{
  "id": "workflow-uuid",
  "nodes": [
    { "id": "trigger-1", "type": "record_created", "config": {...} },
    { "id": "condition-1", "type": "if", "config": { "field": "status", "op": "eq", "value": "紧急" } },
    { "id": "action-1", "type": "update_record", "config": { "field": "priority", "value": "高" } },
    { "id": "action-2", "type": "send_notification", "config": { "to": "manager", "template": "..." } }
  ],
  "edges": [
    { "from": "trigger-1", "to": "condition-1" },
    { "from": "condition-1", "to": "action-1", "output": "true" },
    { "from": "condition-1", "to": "action-2", "output": "false" }
  ]
}
```

- **执行引擎**：DAG 拓扑排序 + 节点执行栈模型（参考 n8n 的 `nodeExecutionStack`）
- **部分执行**：简单 Trigger→Action 模式不需要完整 DAG，后期分支/循环需要
- **取消支持**：使用 `AbortController` 实现

---

## 二、任务调度系统（BullMQ + NestJS）

### 2.1 BullMQ 核心能力

BullMQ 是基于 Redis 的分布式任务队列，NestJS 官方推荐（`@nestjs/bullmq`）：

```typescript
import { Queue, Worker } from 'bullmq';

const queue = new Queue('automation');
await queue.add('run-workflow', { workflowId: '...', triggerData: {...} });

const worker = new Worker('automation', async job => {
  return executeWorkflow(job.data);
});
```

**Repeatable Jobs（定时任务）**：
- 基于 Redis 的重复任务机制，支持 Cron 表达式
- 即使应用重启也不会丢失（持久化在 Redis 中）
- 支持优先级、延迟执行

### 2.2 Cron 触发器实现（参考 n8n）

```typescript
// n8n 的 ScheduledTaskManager（基于 cron 库）
export class ScheduledTaskManager {
  readonly cronsByWorkflow: CronsByWorkflow = new Map();

  registerCron(ctx: CronContext, onTick: () => void) {
    const job = new CronJob(expression, () => {
      if (!this.instanceSettings.isLeader) return; // 多实例只有 leader 执行
      onTick();
    }, undefined, true, timezone);
  }

  deregisterCrons(workflowId: string) { /* 停止并移除 */ }
}
```

- 使用 `cron` npm 包实现定时触发
- 多实例部署：只有 `isLeader` 实例执行 cron
- 按 workflowId 管理生命周期，激活时注册，停用时注销

### 2.3 NestJS 集成方案

```
@nestjs/bullmq + @nestjs/schedule
├── BullMQ: 异步任务队列（工作流执行、Webhook推送、批量操作）
├── @nestjs/schedule: 基于 cron 的定时任务（Cron 触发器）
└── Redis: 任务持久化 + 分布式锁 + 去重
```

推荐架构：
- 自动化执行请求 → 入 BullMQ 队列 → Worker 消费执行
- Cron 触发器 → `@nestjs/schedule` + leader election → 触发工作流
- 失败任务自动重试（利用 BullMQ 内置 retry 机制）

---

## 三、错误处理和重试机制

### 3.1 BullMQ 内置重试策略

**固定延迟重试**：
```typescript
await queue.add('run-workflow', data, {
  attempts: 3,
  backoff: { type: 'fixed', delay: 1000 }
});
```

**指数退避重试**：
```typescript
await queue.add('run-workflow', data, {
  attempts: 8,
  backoff: { type: 'exponential', delay: 1000 }
});
// 延迟计算：2^(attempts-1) * delay
```

**带抖动的指数退避**（推荐，防惊群效应）：
```typescript
await queue.add('run-workflow', data, {
  attempts: 8,
  backoff: { type: 'exponential', delay: 3000, jitter: 0.5 }
});
```

**自定义退避策略**：
```typescript
const worker = new Worker('automation', async job => doProcessing(), {
  settings: {
    backoffStrategy: (attemptsMade, type, err, job) => {
      switch (type) {
        case 'api-call': return attemptsMade * 2000;
        case 'db-write': return Math.min(attemptsMade * 1000, 30000);
        default: return -1; // 不重试
      }
    }
  }
});
```

### 3.2 死信队列模式

```
任务失败 → BullMQ 自动重试(attempts次) → 仍失败 → 进入failed集合
                                                    ↓
                                           记录到 automation_runs 表
                                           status = 'failed', error = 错误信息
                                                    ↓
                                           管理员可在 UI 查看并手动重试
```

BullMQ 的失败任务处理：
- 失败任务自动进入 `failed` 集合
- 可通过 `queue.getFailed()` 获取所有失败任务
- 可手动重试：`job.retry()`

### 3.3 工作流级别错误处理

```typescript
interface WorkflowErrorConfig {
  // 节点级别
  nodeRetryAttempts: number;     // 默认 3
  nodeBackoffType: 'exponential' | 'fixed';
  nodeBackoffDelay: number;      // 默认 1000ms

  // 工作流级别
  workflowTimeout: number;       // 整体超时，默认 5 分钟
  continueOnError: boolean;      // 某节点失败后是否继续

  // 通知
  notifyOnFailure: boolean;      // 失败时通知工作流创建者
}
```

---

## 四、脚本沙箱（安全执行用户代码）

### 4.1 isolated-vm 分析

`isolated-vm` 是 Node.js 中最成熟的 V8 Isolate 沙箱库，被 Screeps、Algolia、Fly.io 等生产使用。

**核心特性**：
- 基于 V8 的 `Isolate` 接口，完全隔离的 JavaScript 环境
- 内存限制可配置（默认 128MB，最小 8MB）
- 支持 CPU 时间和 Wall 时间统计

**基本用法**：
```typescript
const ivm = require('isolated-vm');

async function runInSandbox(code: string, context: Record<string, any>) {
  const isolate = new ivm.Isolate({ memoryLimit: 32 }); // 32MB
  const context = isolate.createContextSync();
  const jail = context.global;

  jail.setSync('global', jail.derefInto());
  jail.setSync('input', new ivm.ExternalCopy(context).copyInto());

  const script = isolate.compileScriptSync(code);
  const result = await script.run(context, { timeout: 5000 }); // 5秒超时
  isolate.dispose();
  return result;
}
```

**关键安全注意事项**：
1. **不要泄漏 ivm 对象**：Reference、ExternalCopy 等实例不可传给不受信任的代码
2. **OOM 风险**：V8 在 OOM 时无法优雅恢复，可能崩溃整个进程
3. **建议独立进程**：将沙箱运行在独立 Node.js 进程中，避免影响主服务
4. **Node.js 20+ 需要 `--no-node-snapshot` 标志**
5. **vm2 已废弃**：vm2 因严重安全漏洞已废弃，不推荐使用

### 4.2 推荐的沙箱架构

```
NestJS 主进程
├── 工作流引擎（不运行用户代码）
├── BullMQ Worker（调度沙箱进程）
└── 子进程管理
    └── 沙箱 Worker 进程（独立进程）
        └── isolated-vm Isolate
            └── 用户脚本执行（受限环境）
```

**多维表格脚本沙箱建议**：
- 初期：不支持自定义脚本，仅内置动作
- 中期：引入 isolated-vm 在独立进程中执行用户脚本
- 提供 `currentRecord`、`table` 等安全 API
- 限制：32MB 内存、5 秒超时、无网络/文件系统访问

---

## 五、数据库触发器与变更数据捕获

### 5.1 PostgreSQL LISTEN/NOTIFY

`pg-listen` 库封装了可靠的 Node.js 实现：

```typescript
import createSubscriber from 'pg-listen';

const subscriber = createSubscriber({ connectionString: databaseURL });

subscriber.notifications.on('record-changed', (payload) => {
  console.log('Record changed:', payload);
  // { tableId, recordId, fieldChanges, userId }
});

await subscriber.connect();
await subscriber.listenTo('record-changed');
```

注意事项：
- LISTEN/NOTIFY 不经过连接池，需要专用连接
- 通知不持久化，接收方不在线则丢失
- 负载上限约每秒数千条通知

### 5.2 应用层事件驱动（推荐方案）

由于已有 OT Changeset 机制，推荐**应用层事件驱动**：

```
数据变更流程：
用户操作 → OT Server 应用 Changeset
         → 发布事件到 Redis Pub/Sub
         → 异步写入 automation_runs 记录
         → 匹配触发条件
         → 创建 BullMQ 任务执行工作流
```

### 5.3 Debezium CDC（大规模方案）

Debezium 基于 Kafka Connect，使用 PostgreSQL 逻辑复制捕获行级变更。
- 适用场景：百万级记录变更/天且需跨服务可靠事件流
- 初期不建议，OT Changeset 已满足需求

---

## 六、Temporal 工作流引擎对比

### 6.1 Temporal 架构

Temporal 是持久执行平台（durable execution），源自 Uber Cadence。

```
用户应用 (Temporal SDK)
    ↕ gRPC
Temporal Cluster
├── Frontend Service    — API 入口
├── History Service     — 分片管理 Workflow 执行状态（事件溯源）
├── Matching Service    — 管理 Task Queue
└── Internal Workers
    ↕
数据库 (Cassandra/PG/MySQL)
```

关键设计：
- **事件溯源**：完整事件历史，可随时回放恢复
- **Workflow vs Activity 分离**：Workflow 确定性无副作用，Activity 执行实际操作
- **Worker 在用户侧运行**

### 6.2 Temporal vs BullMQ 对比

| 维度 | BullMQ | Temporal |
|------|--------|----------|
| **定位** | Redis 分布式任务队列 | 持久工作流执行平台 |
| **状态管理** | Redis 内存 | 数据库事件溯源 |
| **工作流支持** | 单任务级别 | 完整 Workflow + Activity |
| **可靠性** | Redis 持久化（AOF/RDB） | 数据库级别持久化 |
| **复杂工作流** | 需自行编排 | 内置 Timer/Signal/Query/Child Workflow |
| **运维成本** | 低（仅 Redis） | 高（需独立 Server 集群 + DB） |
| **NestJS 集成** | `@nestjs/bullmq` 官方 | `nestjs-temporal` 社区 |
| **适用场景** | 简单任务队列、重试、定时 | 长时运行的复杂业务流程 |

### 6.3 分阶段策略

**第一阶段（MVP）**：BullMQ + 自研执行引擎
- Trigger→Action 简单模型
- BullMQ 处理异步执行和重试
- 自己实现基本 DAG 执行

**第二阶段**：增强自研引擎
- 条件分支、循环、并行执行
- isolated-vm 脚本沙箱
- 完善错误处理和死信队列

**第三阶段（可选）**：引入 Temporal
- 工作流复杂度持续增长（子流程、人工审批、长等待）
- 需要强一致性和完整审计追踪

---

## 七、推荐的自动化引擎架构

```
┌──────────────────────────────────────────────────────┐
│                   触发器管理器                          │
│  ┌──────────┐  ┌───────────┐  ┌──────────────────┐   │
│  │ 事件触发  │  │ Cron定时  │  │ Webhook 接收     │   │
│  │(Changeset│  │(@nestjs/  │  │(HTTP endpoint)   │   │
│  │ →匹配)   │  │ schedule) │  │                  │   │
│  └────┬─────┘  └─────┬─────┘  └────────┬─────────┘   │
│       └──────────────┼──────────────────┘             │
│                      ▼                                │
│              BullMQ Queue (automation)                │
│              - 指数退避重试(attempts=3)                │
│              - 失败进入 failed 集合                    │
│                      │                                │
│                      ▼                                │
│              ┌──────────────┐                         │
│              │ 执行引擎      │                         │
│              │ - 解析 nodes/edges                     │
│              │ - DAG 拓扑排序                         │
│              │ - 逐节点执行                           │
│              │ - AbortController 取消支持              │
│              └──────┬───────┘                         │
│                     │                                 │
│              ┌──────┴───────┐                         │
│              │ 动作执行器    │                         │
│              │ - 更新记录    │                         │
│              │ - 发送通知    │                         │
│              │ - Webhook调用 │                         │
│              │ - 脚本沙箱    │ (isolated-vm 子进程)    │
│              └──────────────┘                         │
│                     │                                 │
│              ┌──────┴───────┐                         │
│              │ PostgreSQL    │                         │
│              │ automation_runs (执行日志)              │
│              └──────────────┘                         │
└──────────────────────────────────────────────────────┘
```

### 关键 NPM 包清单

| 包名 | 用途 | 阶段 |
|------|------|------|
| `bullmq` + `@nestjs/bullmq` | 任务队列 + 重试 | 第一阶段 |
| `@nestjs/schedule` | Cron 定时触发 | 第一阶段 |
| `cron` | 精细 Cron 管理 | 第一阶段 |
| `isolated-vm` | 用户脚本沙箱 | 第二阶段 |
| `pg-listen` | PG LISTEN/NOTIFY（可选） | 第二阶段 |
| `@temporalio/sdk` + `nestjs-temporal` | 复杂工作流（可选） | 第三阶段 |

---

## 参考链接

- [n8n GitHub](https://github.com/n8n-io/n8n)
- [n8n WorkflowExecute 源码](https://github.com/n8n-io/n8n/blob/master/packages/core/src/execution-engine/workflow-execute.ts)
- [n8n DirectedGraph 源码](https://github.com/n8n-io/n8n/blob/master/packages/core/src/execution-engine/partial-execution-utils/directed-graph.ts)
- [BullMQ GitHub](https://github.com/taskforcesh/bullmq)
- [BullMQ 重试文档](https://docs.bullmq.io/guide/retrying-failing-jobs)
- [NestJS BullMQ 集成](https://github.com/nestjs/bull/tree/master/packages/bullmq)
- [NestJS Schedule 模块](https://github.com/nestjs/schedule)
- [isolated-vm GitHub](https://github.com/laverdet/isolated-vm)
- [pg-listen GitHub](https://github.com/andywer/pg-listen)
- [Debezium GitHub](https://github.com/debezium/debezium)
- [Temporal GitHub](https://github.com/temporalio/temporal)
- [Temporal 架构文档](https://github.com/temporalio/temporal/blob/main/docs/architecture/README.md)
- [Temporal TypeScript 示例](https://github.com/temporalio/samples-typescript)
- [NestJS Temporal 集成](https://www.npmjs.com/package/nestjs-temporal)
