# 自动化工作流引擎设计

## 核心模型: Trigger → Condition → Action

多维表格的自动化工作流遵循统一模型:

```
[触发器 Trigger] → [条件判断 Condition] → [动作 Action(s)]
```

参考 Airtable/n8n/飞书，触发器和动作的类型:

### 触发器类型 (Triggers)
| 触发器 | 说明 |
|--------|------|
| 记录创建 | 新行被创建时 |
| 记录更新 | 指定字段被修改时 |
| 记录匹配条件 | 记录满足某个筛选条件时 |
| 表单提交 | 表单被提交时 |
| 定时触发 | Cron定时任务 |
| Webhook接收 | 外部系统推送事件 |
| 手动触发 | 用户点击按钮 |

### 动作类型 (Actions)
| 动作 | 说明 |
|------|------|
| 更新记录 | 修改指定字段值 |
| 创建记录 | 在当前表或其他表新建记录 |
| 发送邮件 | 通知相关人员 |
| 发送消息 | 飞书/钉钉/Slack通知 |
| 调用Webhook | 推送数据到外部系统 |
| 运行脚本 | 执行自定义代码 |
| 等待 | 延迟执行 |
| 请求审批 | 发起审批流程 |

### 条件/分支
- If/Else 条件判断
- Switch 多分支
- 循环

## 架构设计

### 参考n8n的架构
n8n 是开源工作流自动化平台，核心架构:
- **节点(Node)**: 每个操作步骤是一个节点
- **触发器节点(Trigger Node)**: 工作流入口
- **动作节点(Action Node)**: 执行具体操作
- **流程控制节点**: If/Switch/Merge等
- **插件系统**: 可扩展自定义节点
- **技术栈**: TypeScript + Node.js

### 自研工作流引擎架构
```
┌─────────────────────────────────────────┐
│          工作流定义层                      │
│  Workflow = Nodes[] + Edges[]           │
│  可视化编辑器(前端) → JSON定义            │
├─────────────────────────────────────────┤
│          触发器管理层                      │
│  - 事件监听(数据变更→匹配触发条件)        │
│  - 定时调度(Cron)                        │
│  - Webhook接收(HTTP endpoint)            │
├─────────────────────────────────────────┤
│          执行引擎                         │
│  - 解析工作流JSON                        │
│  - 按节点拓扑排序执行                     │
│  - 条件分支/循环/并行                     │
│  - 错误处理和重试                         │
├─────────────────────────────────────────┤
│          动作执行层                       │
│  - 内置动作(更新记录、发邮件等)            │
│  - Webhook调用                           │
│  - 脚本沙箱执行                           │
│  - 第三方API集成                          │
├─────────────────────────────────────────┤
│          事件存储                         │
│  - 执行日志(哪个触发器→哪些动作→结果)     │
│  - 失败重试队列                           │
│  - 执行历史审计                           │
└─────────────────────────────────────────┘
```

### 数据库设计
```sql
-- 工作流定义
CREATE TABLE automations (
    id          UUID PRIMARY KEY,
    table_id    UUID REFERENCES tables(id),
    name        VARCHAR(255),
    enabled     BOOLEAN DEFAULT true,
    trigger_config JSONB,     -- 触发器配置
    nodes       JSONB,        -- 工作流节点定义
    edges       JSONB,        -- 节点连接关系
    created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- 执行日志
CREATE TABLE automation_runs (
    id              UUID PRIMARY KEY,
    automation_id   UUID REFERENCES automations(id),
    trigger_event   JSONB,      -- 触发事件详情
    status          VARCHAR(20), -- pending/running/success/failed
    result          JSONB,       -- 执行结果
    started_at      TIMESTAMPTZ,
    finished_at     TIMESTAMPTZ,
    error           TEXT
);
```

### 触发机制: 事件驱动 vs 轮询
| 方式 | 优点 | 缺点 |
|------|------|------|
| **事件驱动** (推荐) | 实时性好，延迟低 | 实现复杂，需要CDC |
| **轮询** (Airtable方案) | 简单可靠 | 延迟5分钟，资源浪费 |

**推荐**: 数据变更事件通过 Changeset 触发 → 匹配自动化规则 → 执行工作流

## 集成能力
- **APITable**: 内置机器人自动化 + n8n/Zapier集成
- **n8n**: 开源工作流平台，可作为独立自动化引擎集成
- **飞书**: AI工作流 + 自动化能力

## 对我们项目的启示
1. 初期实现简单Trigger→Action模型即可
2. 触发器可以从Changeset事件派生，无需额外轮询
3. 条件判断和分支是中等复杂度的核心功能
4. 脚本沙箱(V8隔离)是高级功能，可后期引入
5. 可考虑集成n8n作为高级自动化方案

## 参考链接
- [n8n架构深度分析](https://jimmysong.io/blog/n8n-deep-dive/)
- [n8n AI工作流架构](https://medium.com/@rajveer.rathod1301/inside-n8ns-ai-workflow-builder-a-complete-architecture-deep-dive-f2eeb2d57ec8)
- [n8n节点/触发器/工作流指南](https://dev.to/ciphernutz/what-are-n8n-nodes-triggers-and-workflows-a-beginners-guide-46hd)
- [Airtable自动化平台](https://www.airtable.com/platform/automations)
- [Airtable触发器和动作](https://wiki.venderflow.com/knowledge-base/airtable-actions-triggers-in-workflows/)
- [Airtable自动化创建记录](https://support.airtable.com/docs/create-record-action)
- [n8n GitHub](https://github.com/n8n-io/n8n)
