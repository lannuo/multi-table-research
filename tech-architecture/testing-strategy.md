# 测试策略

## 测试金字塔
```
        /  E2E测试  \          10%  — 核心用户流程
       / 集成测试    \         20%  — API + 数据库 + WebSocket
      /  单元测试      \       70%  — 纯函数、工具类、业务逻辑
```

## 多维表格的特殊测试需求

### 协作场景测试
- **多用户并发编辑**: 模拟多个WebSocket连接同时编辑同一记录
- **OT/CRDT正确性**: 验证操作变换在各种并发场景下的一致性
- **冲突解决**: 同时修改同一单元格的冲突处理

### 性能测试
- **大数据量渲染**: 10万行数据的虚拟滚动性能
- **公式计算性能**: 复杂公式在大数据集上的计算时间
- **WebSocket并发**: 1000+并发连接的稳定性

## 测试工具选型

| 层级 | 工具 | 说明 |
|------|------|------|
| 单元测试 | Vitest | Vite生态，速度快 |
| 集成测试 | Supertest + Vitest | API层测试 |
| E2E测试 | Playwright (推荐) | 跨浏览器，支持多Tab(适合协作测试) |
| 性能测试 | k6 / Artillery | 负载测试 |
| 视觉回归 | Playwright截图对比 | UI变更检测 |

### Playwright vs Cypress
| 维度 | Playwright | Cypress |
|------|-----------|---------|
| 多浏览器 | Chrome/Firefox/Safari | 主要Chrome |
| 多Tab/多窗口 | 支持(适合协作测试) | 不支持 |
| 执行速度 | 快 | 较慢 |
| 社区 | 快速增长 | 成熟 |
| 推荐度 | 更适合协作场景测试 | 适合常规Web测试 |

## 测试策略实施

### 阶段1: 基础测试
- 核心 CRUD API 的单元测试
- 数据模型的单元测试
- OT操作变换的单元测试

### 阶段2: 集成测试
- API + 数据库的集成测试
- WebSocket实时更新的集成测试
- 自动化工作流的集成测试

### 阶段3: E2E测试
- 创建表 → 添加字段 → 录入数据 → 切换视图
- 多用户协作编辑流程
- 导入导出流程

### 阶段4: 性能测试
- 大数据量场景的性能基准
- 并发用户的负载测试
- 长时间运行的稳定性测试

## 参考链接
- [E2E测试完全指南 - 知乎](https://zhuanlan.zhihu.com/p/2009598881713898864)
- [测试策略实践2025](https://www.xinniyun.com/%E5%85%B6%E4%BB%96/article-automated-testing-strategy-pyram)
- [E2E测试最佳实践 - IBM](https://www.ibm.com/think/insights/end-to-end-testing-best-practices)
