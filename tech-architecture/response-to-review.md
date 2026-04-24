# 审查回应：未消解张力的解释与修正

> 日期: 2026-04-24
> 背景: 对 review-decision-docs.md 提出的三个决策层面未消解张力的回应

---

## 一、回应：复合风险（2.1）

审查指出：decision-review-critique.md 建议回归保守 baseline，但 CRDT 和公式引擎的激进选择未被执行。

**承认**：审查是对的。我在 decision-review-critique.md 中提出了复合风险警告，但在后续决策中只对后端语言采纳了保守建议。这不是疏忽，而是有意识的取舍，但没有写下来。以下是缺失的推理：

### 区分两类决策

| 类型 | 例子 | 后换成本 | 策略 |
|------|------|---------|------|
| 可后换 | 后端语言、UI 组件、部署方式 | 低——API 边界不变，接口替换 | **可以先保守** |
| 不可后换 | CRDT 库、数据模型、公式引擎 | 高——渗透整个系统，替换 = 重写 | **必须一步到位** |

CRDT 选择影响：
- 前端数据绑定方式（Canvas 渲染器如何订阅变更）
- 后端协作层架构（同步协议、冲突解决）
- 数据持久化格式（CRDT 快照 vs 操作日志）
- 离线编辑支持（CRDT 天然支持，乐观锁需要排队机制）
- 版本控制实现（Loro DAG vs 自建快照轮转）

如果 V1 用乐观锁、V2 换 CRDT：数据模型和协作层全部重写。相比之下，NestJS 到 Rust 的迁移（如果发生）是 API 层的替换，成本低得多。

**这个区分应该写在 decision-review-critique.md 里，但没有。** 这是审查最有价值的发现——只列了风险，没做风险分级。

### CRDT 选型的独立验证

审查也提到"50 人并发场景下不需要 CRDT"。这个判断是对的——竞品证明了不需要。但全功能产品不只是 50 人场景。Loro 选的不是"50 人"，而是：MovableList（行列拖拽必须在数据结构层面解决）、Git-like DAG（版本历史是产品需求，不是 nice-to-have）、Shallow Snapshot（10 万行+大文档的内存管理）。

也就是说——选了 CRDT 不是因为"没有 CRDT 不行"，而是因为"Loro 的三个原生能力恰好覆盖了我们产品的三个核心需求"。

**修正**：在 decision-crdt-loro-vs-yjs.md 中补充一节，解释 CRDT 选型不是因为"协作需要"，而是因为 Loro 的其他能力。

---

## 二、回应：MVP 原则与 Loro 矛盾（2.2）

审查指出 mvp-scope-definition.md 写了"能用乐观锁不引入 CRDT"，但最终选了 Loro。

**修正**：将 MVP 文档中的这条原则改为：

> 优先验证关键技术假设，在不可后换的决策上一步到位。CRDT（Loro）和公式引擎（Formualizer）在 V1 引入，其他组件（自动化、高级权限、BI 仪表盘）可以推迟。

同时补充解释：

> V1 引入 CRDT 的理由不是"50 人协作需要 CRDT"（确实不需要），而是 Loro 的 MovableList（行列拖拽）、Git-like DAG（版本历史）、Shallow Snapshot（大文档内存管理）是产品的核心需求。如果我们选的 CRDT 库恰好也解决了协作问题，这不是过度设计。

---

## 三、回应：Formualizer 风险被低估（2.3）

审查指出三个缺失：测试时机、回退方案、HyperFormula 定价。

### 3.1 测试时机

100 个高频公式测试应在**写第一行业务代码之前**完成。具体：

1. 列出 100 个最常见的 Excel 公式（参考 Google Sheets 函数使用频率统计）
2. 用 Formualizer v0.3 逐条测试
3. 通过率 ≥ 90% → 可以开始用
4. 通过率 < 90% → 触发 Plan B

### 3.2 Plan B

如果 Formualizer 测试不通过，回退方案按优先级：

| 优先级 | 方案 | 代价 |
|--------|------|------|
| 1 | 贡献给 Formualizer 上游修复缺失函数 | 时间不确定 |
| 2 | 服务端用 Python (IronCalc 或自定义) 计算，前端展示结果 | 失去了 WASM 前端计算的优势，只支持弱网场景 |
| 3 | HyperFormula 商业许可 | 需要询价，但风险最低 |

Plan B 不是"从头写公式引擎"，而是"接受服务端计算的延迟换取功能完整性"。

### 3.3 HyperFormula 商业许可

HyperFormula 由 Handsontable 维护。Handsontable 的商业许可起价约 $790/developer/年（2024 年定价）。需要直接联系确认 HyperFormula 独立许可的价格。

**如果年费 < $2,000，且 Formualizer 测试未通过，应该直接购买 HyperFormula 许可。** 这个价格远低于自己修复 Formualizer 缺失函数的时间成本。

---

## 四、缺失文档回应

### 4.1 Solo 开发时间线估算

以 solo 开发 + AI 辅助为前提：

| 阶段 | 预估时间 | 交付物 |
|------|---------|-------|
| 项目骨架 + 数据模型 + 基础 CRUD | 2-3 周 | API 可创建表/字段，写入数据 |
| Canvas 表格 + 虚拟滚动 + 字段类型 | 3-4 周 | 可交互的数据表格 |
| 用户认证 + 工作区 + 权限 | 2-3 周 | 多用户可用 |
| Loro CRDT 集成 + WebSocket 同步 | 3-4 周 | 多人实时编辑 |
| 筛选/排序/分组/搜索 | 2-3 周 | 完整表格交互 |
| 公式引擎集成（Formualizer） | 2-3 周 | 公式计算 |
| 表单视图 + 导入导出 | 2-3 周 | 基础完整度 |
| 自动化 + 看板视图 + 完善 | 4-6 周 | 产品可上线 |

**总计约 20-30 周**（5-8 个月）到可上线状态，全职投入。

### 4.2 Bus Factor 应对

| 依赖 | 风险 | 应对 |
|------|------|------|
| loro-extended (SchoolAI) | 单公司维护 | 核心 CRDT 是 Loro（独立项目）；loro-extended 的 PG 适配器和 React Hooks 代码量小（~2000 行），读通后可自维护 |
| Formualizer (PSU3D0) | 个人维护 | MIT 许可；核心公式解析和求值是纯算法，不依赖外部服务；最坏情况下 Fork 自维护核心公式集 |
| Loro 偏离方向 | 团队决策 | Loro 的核心场景就是协作编辑，多维表格是其主要目标场景；MIT 许可 |

关键原则：**MIT 许可 = 可以自己接手。** 这是选择 Loro 和 Formualizer（而非 AGPL 项目）的重要原因之一。

---

## 五、已执行的修正

- notes.md 旧 Rust 架构图已删除
- 文件索引 `└──` 乱用已修正
- `poc/postgres-jsonb-bench` → `poc/postgres-jsonb-analysis`
- mvp-scope-definition.md 技术原则已更新：从"能用乐观锁不引入 CRDT"改为区分可后换/不可后换决策
- decision-crdt-loro-vs-yjs.md 已补充"选 Loro 不是因为协作需要"的说明
- decision-formula-engine.md 已补充 Plan B 回退方案（IronCalc 服务端计算 / Fork 自维护），并明确仅接受 MIT/Apache-2.0 许可约束
- decision-make-vs-buy.md 已补充 AGPL 许可约束对 Fork 方案的否决理由
