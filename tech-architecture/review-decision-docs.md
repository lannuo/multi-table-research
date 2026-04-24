# 决策文档审查：问题与未消解的张力

> 审查日期: 2026-04-24
> 背景: 对第六轮新增的决策文档、MVP 定义、竞品分析、PoC 验证进行独立审查，识别残留问题和内部矛盾。

---

## 一、必须修复的问题

### 1.1 notes.md 存在两份互相矛盾的架构图

notes.md 第 92-113 行是新的 NestJS 架构图，第 125-152 行仍保留着旧的 Rust (Axum) 架构图。同一个文件出现两个"核心架构总览"小节，后端从 NestJS 变回 Rust，数据层从 JSONB 混合模型变回 CRDT 快照/操作日志。

这是合并残留。任何读者看到这个文件都会困惑"到底用哪个架构"。

**需要删除第 125-152 行的旧架构图，只保留新的 NestJS 版本。**

### 1.2 文件索引格式不一致

notes.md 文件索引中，`└──` 应只用于目录内最后一个条目，但多处非末尾条目也用了 `└──`：
- `product-design/` 目录下 `mvp-scope-definition.md` 用了 `└──`，但它上面 `scenario-templates.md` 也用了 `└──`
- `tech-architecture/` 目录下大量非末尾条目用了 `└──`
- `data-storage/` 目录下 `file-based-arrow-storage.md` 用了 `└──`，但它上面 `database-schema-detail.md` 也用了 `└──`

应统一为：中间条目用 `├──`，最后一个用 `└──`。

---

## 二、决策层面的未消解张力

### 2.1 审查建议 vs 最终决策：复合风险未被完全回应

decision-review-critique.md 的核心建议是：

> 四个中高风险组件叠加在一起形成复合风险。建议回归保守 baseline：NestJS + PostgreSQL + OT。

最终四个决策文档的执行情况：

| 审查建议 | 最终决策 | 是否采纳 |
|---------|---------|---------|
| 后端回归 NestJS | NestJS | 采纳 |
| 协作考虑 OT | Loro CRDT | 未采纳 |
| 公式考虑 HyperFormula | Formualizer v0.3 | 未采纳 |
| 前端框架风险 | loro-extended | 未回应 |

后端风险消除了，但 Loro + Formualizer + loro-extended 三个中高风险组件仍然叠加。审查文档自己列的竞品数据证明了 **50 人并发场景下不需要 CRDT**（Baserow/NocoDB/Grist 都不用），但最终仍然选了 CRDT。

这不是说选 Loro 一定错——有明确的技术理由（MovableList、Shallow Snapshot、Git-like DAG）。问题在于没有一份文档正面回应"审查文档提出的复合风险担忧"，解释为什么在这个风险水平上仍然值得选 Loro。

### 2.2 MVP 范围定义与 Loro 选型的直接矛盾

mvp-scope-definition.md 第三节技术原则第 1 条：

> 先简单后复杂：能用 PostgreSQL 解决的不引入新组件，**能用乐观锁的不引入 CRDT**

decision-crdt-loro-vs-yjs.md 最终选了 Loro CRDT。

这两句话不可能同时为真。需要明确以下之一：

- **选项 A**：V1 就上 Loro，把 MVP 原则改为"优先验证关键技术假设，在核心选型上一步到位"
- **选项 B**：V1 先用乐观锁 + WebSocket 广播（参考 Baserow），V2 再引入 Loro

两种路径都可行，但当前文档没有做出选择。

### 2.3 decision-formula-engine.md 低估了 Formualizer v0.3 的风险

风险缓解策略只有两条：

1. "MIT 许可可自行修复"
2. "100 个高频公式测试"

缺少关键信息：

- **测试时机**：什么时候做这 100 个公式测试？开发前还是开发中？如果开发到一半才发现 30% 高频函数有 bug，回头成本多大？
- **回退方案**：如果测试发现不可接受的问题，Plan B 是什么？回到 HyperFormula？等 IronCalc v1.0？自己写？
- **HyperFormula 商业许可价格**：文档以 AGPL 为由排除了 HyperFormula，但从未查询商业许可价格。如果年费在可接受范围内，它就是风险最低的选项。

---

## 三、缺失的文档

### 3.1 Solo 开发时间线估算

decision-make-vs-buy.md 估算了 15K-25K 行代码，但没估算时间。对 solo 开发者来说，"多少个月能到 MVP"比代码行数更关键。

建议补充：

| 阶段 | 预估时间 | 交付物 |
|------|---------|-------|
| Canvas 表格 + 字段类型 + 基础 CRUD | ? | 可操作的数据表 |
| 用户系统 + 权限 | ? | 多用户可用 |
| 实时协作（Loro 或乐观锁） | ? | 多人编辑 |
| 筛选/排序/分组/搜索 | ? | 完整表格视图 |
| 公式引擎集成 | ? | 计算能力 |
| 导入/导出 | ? | 数据迁移 |

### 3.2 关键依赖的断供应对

loro-extended 由 SchoolAI 单公司维护（bus factor = 1）。Formualizer 由个人开发者维护。虽然都是 MIT 许可，但 solo 开发者自维护一个 CRDT 框架的持续成本很高。

缺少对以下场景的应对方案：

- loro-extended 停更 6 个月，出现与 Loro v2 不兼容的问题
- Formualizer 作者失去维护意愿，关键 bug 无人修复
- Loro 核心团队的方向偏离多维表格场景

---

## 四、小问题

### 4.1 poc/postgres-jsonb-bench/ 命名误导

目录名 `postgres-jsonb-bench` 暗示有可运行的 benchmark 代码，但实际只有一篇文献综述 README。Canvas PoC 有完整可运行的项目（Vite + React + Playwright 测试），对比之下 JSONB 这个"bench"名不副实。

两种改法：
- 改名为 `postgres-jsonb-analysis/`，与实际内容一致
- 或补充可运行的 benchmark SQL 脚本

---

## 五、总结

新增文档整体质量高，填补了三个真正的缺口（MVP 范围、Make vs Buy、决策自我审查）。但存在两类残留问题：

1. **执行层面**：notes.md 合并残留（必须修）
2. **决策层面**：审查文档的保守建议没有完全被执行，且没有文档解释为什么选择不执行。这给未来的自己（或接手者）留下了困惑："到底是该保守还是激进？"

建议下一步：先修 notes.md，然后明确 CRDT 进场时机（V1 还是 V2），再补充时间线估算。
