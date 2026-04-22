# 版本控制与撤销重做

## 核心挑战
在协作环境下的撤销/重做比单人场景复杂得多:
- 用户A的撤销不应影响用户B的并发操作
- 需要记录"谁在什么时候改了什么"
- 需要支持恢复到任意历史版本

## OT系统中的版本控制

### 基于Operation Log
- 每次操作(Operation)记录到日志
- 操作包含: revision(版本号), type, target, before, after
- 版本号全局递增

### 版本历史实现
```
方式1: 重放(Replay)
  从初始状态 → 逐个应用Operation → 到达目标版本
  适合操作不多的场景

方式2: 快照(Snapshot)
  定期保存完整数据快照
  恢复时: 找到最近的快照 → 重放少量Operation → 到达目标
  APITable采用此方案(revisionHistory记录每行涉及的版本号)
```

### APITable的版本模型
- Changeset = 一组Operation的集合
- 每个Changeset有递增的revision号
- 每条记录维护 `revisionHistory` 数组，记录该行被哪些版本修改过
- Snapshot = 某个revision时刻的完整数据状态

### Notion的版本模型
- 事务(Transaction) = 一批操作
- 客户端通过TransactionQueue发送到服务器
- 服务器通过saveTransactions持久化
- 后台调度版本历史快照

## 撤销/重做(Undo/Redo)

### 单人场景
```
Undo栈: [op1, op2, op3]
Redo栈: []

用户Undo → op3的逆操作入Redo栈 → Undo栈变为[op1, op2]
用户Redo → op3重新执行 → 入Undo栈
```

### 协作场景 (复杂)
- **选择性Undo**: 只撤销自己的操作，不影响他人的操作
- **OT + Undo**: 撤销操作需要经过OT变换，因为文档状态可能已被他人修改
- CRDT方案: Undo = 插入一个反向操作，CRDT自动处理冲突

### 推荐实现
```
1. 每次Changeset记录userId
2. Undo栈按用户隔离
3. Undo时生成反向Changeset
4. 反向Changeset经过OT/CRDT处理后应用
```

## 数据库设计
```sql
-- 操作日志
CREATE TABLE changesets (
    id          UUID PRIMARY KEY,
    table_id    UUID NOT NULL,
    revision    BIGINT NOT NULL,    -- 全局递增
    user_id     UUID NOT NULL,
    operations  JSONB NOT NULL,     -- [{action, recordId, fieldId, before, after}]
    created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- 快照 (定期生成)
CREATE TABLE snapshots (
    id          UUID PRIMARY KEY,
    table_id    UUID NOT NULL,
    revision    BIGINT NOT NULL,    -- 对应的版本号
    data        JSONB NOT NULL,     -- 完整的Snapshot数据
    created_at  TIMESTAMPTZ DEFAULT NOW()
);
```

## 快照策略
| 策略 | 说明 |
|------|------|
| 按时间 | 每5分钟/每小时生成快照 |
| 按操作数 | 每100个Changeset生成快照 |
| 按触发 | 用户手动保存版本时 |
| 按重要性 | 重大变更（批量操作、导入）后 |

## 参考链接
- [OT维基百科](https://en.wikipedia.org/wiki/Operational_transformation)
- [CRDT vs OT对比](https://systemdr.substack.com/p/crdts-vs-operational-transformation)
- [OT实现经验](https://dev.to/knemerzitski/my-experience-implementing-operational-transformation-ot-from-scratch-27pd)
- [OT实现指南](https://oneuptime.com/blog/post/2026-01-30-operational-transformation/view)
- [Figma多人协作技术](https://www.figma.com/blog/how-figmas-multiplayer-technology-works/)
- [ot-engine (GitHub)](https://github.com/yiminghe/ot-engine)
