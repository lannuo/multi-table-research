# Webhook与事件系统设计

## 核心需求
多维表格需要对外推送数据变更事件:
- 外部系统订阅表的数据变更
- 自动化工作流的触发源
- 第三方集成(n8n, Zapier等)

## 架构设计

### 事件驱动架构
```
数据变更 → Changeset → 事件发布 → [消息队列] → 多种消费者
                                              ├── Webhook推送
                                              ├── 自动化触发
                                              ├── 搜索索引同步
                                              └── 审计日志
```

### 事件类型
```json
{
    "event": "record.created",
    "tableId": "xxx",
    "recordId": "yyy",
    "data": { ... },
    "timestamp": 1655876993000,
    "userId": "zzz"
}
```

| 事件 | 说明 |
|------|------|
| record.created | 记录创建 |
| record.updated | 记录更新(含字段级详情) |
| record.deleted | 记录删除 |
| field.created | 字段创建 |
| field.updated | 字段配置变更 |
| field.deleted | 字段删除 |
| view.created | 视图创建 |
| view.updated | 视图配置变更 |
| table.imported | 数据导入完成 |

## Webhook系统设计

### 核心组件
```
┌──────────────┐    ┌──────────────┐    ┌──────────────┐
│  事件生产者    │───→│  消息队列     │───→│ Webhook Worker│
│  (Changeset)  │    │  (Redis/PG)  │    │  (HTTP推送)    │
└──────────────┘    └──────────────┘    └──────────────┘
                                               │
                                        ┌──────┴──────┐
                                        │ 重试 + 死信队列│
                                        └─────────────┘
```

### Webhook订阅管理
```sql
CREATE TABLE webhook_subscriptions (
    id          UUID PRIMARY KEY,
    table_id    UUID REFERENCES tables(id),
    url         TEXT NOT NULL,
    secret      VARCHAR(255),       -- HMAC签名密钥
    events      TEXT[],              -- 订阅的事件类型
    enabled     BOOLEAN DEFAULT true,
    created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE webhook_deliveries (
    id          UUID PRIMARY KEY,
    subscription_id UUID REFERENCES webhook_subscriptions(id),
    event       TEXT NOT NULL,
    payload     JSONB NOT NULL,
    status      VARCHAR(20),         -- pending/success/failed
    response_code INT,
    attempts    INT DEFAULT 0,
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    delivered_at TIMESTAMPTZ
);
```

### 可靠性保障
| 机制 | 说明 |
|------|------|
| HMAC签名 | 用secret对payload签名，接收方验证来源 |
| HTTPS | 强制使用HTTPS |
| 重试机制 | 指数退避重试(1s, 5s, 30s, 5min) |
| 死信队列 | 超过重试次数进入死信队列 |
| 幂等性 | 每个delivery有唯一ID，接收方应做幂等处理 |
| 超时控制 | HTTP请求30秒超时 |

## 与自动化工作流的关系
Webhook系统是自动化工作流的"外部触发器":
- 外部事件 → Webhook → 自动化触发器 → 工作流执行
- 工作流执行 → Webhook动作 → 推送到外部系统

## 参考链接
- [Webhook系统设计指南](https://www.systemdesignhandbook.com/guides/design-a-webhook-system/)
- [事件驱动Webhook架构](https://dev.to/vikthurrdev/designing-a-webhook-service-a-practical-guide-to-event-driven-architecture-3lep)
- [Webhook系统设计题](https://systemdesignschool.io/problems/webhook/solution)
- [实时Webhook通知](https://sdcourse.substack.com/p/day-90-building-real-time-webhook)
