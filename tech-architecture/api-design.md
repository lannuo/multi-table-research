# API设计方案

## 需求分析
多维表格的API需要支持:
- **CRUD操作**: 表、字段、记录、视图的增删改查
- **实时订阅**: 数据变更的实时推送
- **批量操作**: 批量创建/更新/删除记录
- **文件上传**: 附件字段的上传下载
- **Webhook管理**: 订阅管理、事件推送

## 方案对比: RESTful vs GraphQL

### RESTful API
```
GET    /api/tables                    # 列出所有表
POST   /api/tables                    # 创建表
GET    /api/tables/:tableId           # 获取表详情
GET    /api/tables/:tableId/records   # 获取记录列表
POST   /api/tables/:tableId/records   # 创建记录
PATCH  /api/tables/:tableId/records/:recordId  # 更新记录
DELETE /api/tables/:tableId/records/:recordId  # 删除记录
```

| 优点 | 缺点 |
|------|------|
| 简单直观，易于理解 | 多次请求获取关联数据 |
| HTTP缓存原生支持 | 容易over-fetching/under-fetching |
| 工具链成熟(Swagger等) | 实时需要额外WebSocket |
| 学习成本低 | 接口数量多 |

### GraphQL
```
query {
  table(id: "xxx") {
    name
    fields { id, name, type }
    records(filter: {status: {eq: "完成"}}, first: 20) {
      edges {
        node { id, data }
      }
    }
  }
}

subscription {
  onRecordChanged(tableId: "xxx") {
    recordId
    fieldId
    newValue
  }
}
```

| 优点 | 缺点 |
|------|------|
| 精确查询，避免过度获取 | 学习曲线陡峭 |
| 单端点，减少请求次数 | 缓存策略复杂 |
| **原生Subscription**支持实时 | 服务端实现复杂 |
| 强类型Schema | 性能调优困难(N+1问题) |

### 推荐: RESTful + WebSocket (混合方案)

**理由**:
- APITable、Notion都采用RESTful风格
- 多维表格的查询模式相对固定(按表查记录)，不需要GraphQL的灵活查询
- 实时更新通过WebSocket独立处理
- 开发效率高，团队容易上手

**实时更新方案**:
```
WebSocket连接 → subscribe(tableId/recordId)
数据变更 → 服务端推送变更事件
客户端 → 收到事件 → 拉取最新数据(或直接应用变更)
```

## API设计规范

### 统一响应格式
```json
{
  "code": 200,
  "message": "success",
  "data": { ... },
  "meta": {
    "page": 1,
    "pageSize": 100,
    "total": 1500
  }
}
```

### 错误响应
```json
{
  "code": 400,
  "message": "Invalid field type",
  "errors": [
    {"field": "fieldType", "message": "Unsupported field type: xxx"}
  ]
}
```

### 核心API端点设计
```
# 数据表
GET/POST         /api/spaces/{spaceId}/tables
GET/PATCH/DELETE /api/tables/{tableId}

# 字段
GET/POST         /api/tables/{tableId}/fields
PATCH/DELETE     /api/fields/{fieldId}

# 视图
GET/POST         /api/tables/{tableId}/views
PATCH/DELETE     /api/views/{viewId}

# 记录
GET/POST         /api/tables/{tableId}/records
PATCH/DELETE     /api/records/{recordId}
POST             /api/tables/{tableId}/records/batch

# 协作
GET              /api/tables/{tableId}/changesets
GET              /api/tables/{tableId}/snapshots/{revision}

# 自动化
GET/POST         /api/tables/{tableId}/automations
PATCH/DELETE     /api/automations/{automationId}
GET              /api/automations/{automationId}/runs

# Webhook
GET/POST         /api/tables/{tableId}/webhooks
DELETE           /api/webhooks/{webhookId}

# 搜索
POST             /api/tables/{tableId}/search
POST             /api/spaces/{spaceId}/search (全局搜索)
```

### 参考APITable的API设计
- `/saveTransactions` — 批量保存操作(Notion方案)
- `/loadPageChunk` — 加载页面数据(Notion方案)
- `dataPack` — 获取Snapshot数据(APITable方案)

## 参考链接
- [REST vs GraphQL vs WebSocket对比](https://medium.com/@vandanbsheth9/beyond-the-request-inside-the-minds-of-rest-graphql-and-websocket-apis-d354a55f0527)
- [AWS: GraphQL vs REST](https://aws.amazon.com/compare/the-difference-between-graphql-and-rest/)
- [GraphQL实时协作](https://www.meegle.com/en_us/topics/graphql/graphql-for-real-time-collaboration)
- [GraphQL Subscription实时数据](https://www.youtube.com/watch?v=c9OXdq-c5oQ)
- [API架构风格对比](https://dev.to/ivannalon/the-6-api-architecture-styles-rest-restful-graphql-soap-grpc-websockets-and-mqtt-2a9h)
