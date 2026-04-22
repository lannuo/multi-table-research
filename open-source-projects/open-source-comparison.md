# 开源多维表格项目对比

## 1. APITable / AITable
- **GitHub**: https://github.com/apitable/apitable
- **定位**: API导向的低代码平台，最强开源 Airtable 替代品
- **技术栈**: NestJS (后端) + Next.js (前端)
- **许可证**: AGPL
- **核心特性**:
  - 实时协作
  - 多视图支持（表格、看板、画廊、表单等）
  - 全栈API访问
  - 支持项目管理和CRM场景
- **相关项目**: AITable.ai（商业版）

## 2. NocoDB
- **GitHub**: https://github.com/nocodb/nocodb
- **定位**: 将现有SQL数据库转为智能表格界面
- **Docker下载量**: 10,000,000+
- **特点**:
  - 直接连接已有SQL数据库，提供可视化界面
  - 轻量级，资源占用小
  - 适合管理现有数据库
  - 自托管无per-seat费用
- **适合场景**: 已有数据库需要可视化管理的团队

## 3. Baserow
- **GitHub**: https://github.com/Baserow/baserow
- **定位**: 从零构建结构化数据集
- **技术栈**: PostgreSQL + Django/Python 后端
- **Docker下载量**: 100,000+
- **特点**:
  - 直观的表格管理界面
  - 适合从零创建数据
  - 自托管无per-seat费用
  - 插件化架构
- **适合场景**: 需要从零构建数据集的团队

## 4. Teable
- **定位**: Airtable-like UI，适合中小团队
- **特点**: Per-seat定价模式（SaaS），也有开源版本

## 5. 对比总结

| 特性 | APITable | NocoDB | Baserow | Teable |
|------|----------|--------|---------|--------|
| **最适合** | API导向应用 | 管理已有SQL数据库 | 从零构建数据集 | 中小团队 |
| **架构** | 全栈独立 | 挂载在SQL DB之上 | 自有后端+PG | 中间方案 |
| **自托管** | 支持 | 支持(轻量) | 支持 | 支持 |
| **流行度** | 高 | 极高(10M+) | 中等 | 新兴 |
| **许可证** | AGPL | AGPL | MIT | - |

## 参考链接
- [Baserow vs NocoDB 对比 - Softr](https://www.softr.io/blog/baserow-vs-nocodb)
- [Baserow vs NocoDB - Medium](https://medium.com/@paul-hicks/baserow-vs-nocodb-two-open-source-airtable-alternatives-67602e66bd91)
- [5个自托管Airtable替代品对比 - NocoBase](https://www.nocobase.com/en/blog/5-self-hosted-airtable-alternatives)
- [NocoDB生态系统评测 - GitHub](https://github.com/nocodb/nocodb/discussions/9009)
- [APITable GitHub](https://github.com/apitable/apitable)
