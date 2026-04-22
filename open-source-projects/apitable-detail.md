# APITable 详细技术资料

> 来源: https://github.com/apitable/apitable

## 技术栈
- **前端**: TypeScript + Next.js
- **后端**: TypeScript (NestJS) + Java (Spring Boot)
- **渲染**: Canvas 渲染引擎（极度流畅的数据库-电子表格界面）
- **实时协作**: OT (Operational Transformation) 算法
- **许可证**: AGPL-3.0
- **部署**: Docker, 支持4核8GB以上环境

## 核心架构概念

### 数据库原生架构
- Changeset / Operation / Action / Snapshot 数据模型
- 支持 100,000+ 数据行 + 实时协作
- 全栈API访问（从数据到元数据）

### 7种视图类型
1. Grid View (数据表)
2. Gallery View (画廊)
3. Mindmap View (思维导图)
4. Kanban View (看板)
5. Full-Feature Gantt View (甘特图)
6. Calendar View (日历)
7. (表单视图)

### 核心功能
- **实时协作**: 多用户同时编辑
- **自动表单**: 一键生成
- **API面板**: 可视化API文档
- **无限跨表链接**: 单向/双向链接
- **行列级权限**: Mirror + 列权限
- **嵌入**: 可嵌入到其他应用
- **机器人自动化**: 自定义自动化工作流
- **BI仪表盘**: 数据可视化
- **Widget系统**: 20+官方开源Widget

### 企业级功能
- SAML, SSO
- 审计日志
- 数据库自动备份
- 数据导出
- 水印
- 文件夹/子文件夹/文件权限
- 团队管理与组织架构

### Space架构
- 使用Space（空间）替代App/Base结构
- 使无限跨表链接成为可能

## 扩展性
- 可扩展 Widget System (20+官方Widget)
- 可自定义图表和仪表盘
- 可自定义列类型
- 可自定义公式
- 可自定义自动化机器人操作

## 集成
- n8n.io
- Zapier
- Appsmith
- ChatGPT (企业版)
- Google Workspace (企业版)

## 未来计划
- Heavy-code Interface Builder
- 可嵌入的第三方文档组件
- SQL-like DSL 查询语言
- IdP 身份提供商
- 高级自动化机器人
- Web 3 功能

## 安装方式
```bash
# Docker Compose
curl https://apitable.github.io/install.sh | bash

# All-in-one (测试用)
sudo docker run -d -v ${PWD}/.data:/apitable -p 80:80 --name apitable apitable/all-in-one:latest
```

## 对我们项目的启示
1. **OT算法**可用于实时协作（非CRDT方案）
2. **Canvas渲染引擎**解决大数据量前端性能
3. **Space架构**让多表关联更灵活
4. **Widget/Plugin系统**是扩展性的关键
5. **AGPL许可证**需要注意商业使用限制
