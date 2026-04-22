# 权限模型设计

## 多维表格的权限需求

### 层级结构
1. **工作空间(Space)** 权限
2. **文件夹(Folder)** 权限
3. **数据表(Table)** 权限
4. **视图(View)** 权限
5. **行(Row)** 级权限
6. **列(Column)** 级权限

### 操作类型
- 读取(Read)
- 创建(Create)
- 编辑(Update)
- 删除(Delete)
- 分享(Share)
- 管理(Admin)

## 行级安全 (Row-Level Security, RLS)

### 数据库层面实现
- **PostgreSQL**: 原生支持 RLS (CREATE POLICY)
- **Azure SQL**: 内置行级安全
- **原理**: 数据库引擎自动过滤行，应用层无需处理

### 应用层面实现
- 查询时自动附加过滤条件
- APITable的Mirror方案: 将视图转为镜像实现行权限
- 每条记录附加 owner/tenant 字段

## 列级权限
- 控制特定列的可见性和可编辑性
- APITable: 简单操作即可激活列权限
- 实现: 查询结果根据用户权限过滤列

## 多租户隔离策略

| 策略 | 隔离级别 | 成本 | 复杂度 |
|------|----------|------|--------|
| 独立数据库 | 最高 | 最高 | 最低 |
| 独立Schema | 高 | 中 | 中 |
| 行级安全 | 中 | 最低 | 最高 |
| 混合方案 | 可调 | 可调 | 中 |

## Notion的权限模型
- 基于Block的Parent指针向上追溯
- 从Block → Parent → ... → Workspace
- 继承式权限

## 推荐方案
1. **初期**: 应用层权限检查 + owner字段过滤
2. **中期**: PostgreSQL RLS 实现行级安全
3. **长期**: 完善的RBAC + RLS混合方案

## 参考链接
- [AWS Row-Level Access Control](https://aws.amazon.com/blogs/big-data/implement-row-level-access-control-in-a-multi-tenant-environment-with-amazon-redshift/)
- [Azure SQL Row-Level Security](https://oneuptime.com/blog/post/2026-02-16-how-to-design-a-multi-tenant-data-isolation-strategy-on-azure-sql-database-using-row-level-security/view)
- [Multi-Tenant RBAC - Aserto](https://www.aserto.com/blog/authorization-101-multi-tenant-rbac)
- [Azure多租户模式 - Microsoft](https://learn.microsoft.com/en-us/azure/azure-sql/database/saas-tenancy-app-design-patterns?view=azuresql)
- [Laravel多租户RLS](https://dev.to/addwebsolutionpvtltd/building-multi-tenant-sa-with-row-level-security-in-laravel-3kd3)
