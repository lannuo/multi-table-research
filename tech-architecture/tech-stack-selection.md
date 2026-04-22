# 技术选型方案

## 各产品技术栈对比

| 产品 | 前端 | 后端 | 数据库 |
|------|------|------|--------|
| APITable | React + Next.js | NestJS + Spring Boot | PostgreSQL |
| NocoDB | Vue.js | Node.js | 连接已有DB |
| Baserow | Vue.js + Nuxt | Django/Python | PostgreSQL |
| Teable | Next.js | NestJS | PostgreSQL |
| Univer | React (插件化) | TypeScript/Go | - |

## 推荐技术栈

### 方案A: TypeScript全栈 (推荐)
```
前端: React + Next.js
后端: NestJS (TypeScript)
数据库: PostgreSQL + Redis
实时通信: WebSocket (Socket.IO)
```

**优点**:
- 前后端统一语言(TypeScript)，降低团队学习成本
- APITable采用此方案，有成熟参考
- NestJS结构化强，适合大型后端
- Next.js支持SSR/SSG，SEO友好
- 生态丰富，招聘容易

**缺点**:
- CPU密集型任务不如Go/Rust

### 方案B: 混合语言栈
```
前端: React + Next.js
后端: NestJS + Go/Rust (计算密集)
数据库: PostgreSQL + Redis
```

**优点**: TypeScript处理业务逻辑，Go/Rust处理计算密集任务
**缺点**: 需要维护两种语言

### 前端核心库选型

| 需求 | 推荐库 | 备选 |
|------|--------|------|
| 表格渲染 | Canvas自研 / react-window | AG Grid, Handsontable |
| 公式引擎 | HyperFormula | 自研 |
| 实时协作 | OT (参考APITable) | Yjs (CRDT) |
| 状态管理 | Zustand / Jotai | Redux Toolkit |
| UI组件 | Ant Design / ShadCN | Arco Design |
| 图表 | ECharts | Chart.js |
| 拖拽 | dnd-kit | react-beautiful-dnd |
| 虚拟滚动 | @tanstack/virtual | react-window |
| 富文本 | ProseMirror / TipTap | Slate.js |

### 后端核心库选型

| 需求 | 推荐 | 备选 |
|------|------|------|
| Web框架 | NestJS | Express + TypeScript |
| ORM | Prisma | TypeORM, Sequelize |
| 消息队列 | Bull (Redis-based) | RabbitMQ |
| 缓存 | Redis + ioredis | - |
| 文件存储 | MinIO / S3 | - |
| 搜索 | Meilisearch | Elasticsearch |
| 任务调度 | node-cron / Bull | Agenda |
| 导入导出 | exceljs + csv-parser | xlsx (SheetJS) |

## 部署架构

### 开发/小团队部署
```
Docker Compose:
  - web (Next.js)
  - api (NestJS)
  - postgres
  - redis
  - minio (文件存储)
```

### 生产/企业部署
```
Kubernetes:
  - 前端: Nginx (静态资源)
  - API: NestJS pods (HPA自动伸缩)
  - Worker: 后台任务处理 pods
  - PostgreSQL: 主从复制 / Citus分片
  - Redis: Sentinel/Cluster
  - MinIO: 分布式对象存储
```

## 参考链接
- [NestJS vs Next.js对比](https://medium.com/@chauhananubhav16/nestjs-vs-next-js-a-comprehensive-technical-comparison-b888bac7aaa3)
- [React电子表格库Top 10](https://medium.com/front-end-world/top-spreadsheet-libraries-for-react-next-js-in-2025-6f7a02ffc3ca)
- [Next.js后端选型讨论](https://www.reddit.com/r/nextjs/comments/1rer0tq/what_techstack-do-nextjs-developers-prefer-for/)
- [NestJS vs Next.js - Contentful](https://www.contentful.com/blog/nestjs-vs-nextjs/)
