# 技术决策回顾审查：问题、缺口与建议

> 审查日期: 2026-04-24
> 背景: 对已记录的架构决策进行辩证性回顾，识别决策过程中的方法论问题、调研盲区和复合风险。

---

## 一、核心诊断：决策速度快于调研深度

当前仓库有 50+ 篇研究文档，表面覆盖广泛，但存在一个根本性的流程问题——**在多轮决策中，研究文档内部对关键风险的警告被决策层忽略**，导致决策反复横跳。

### 1.1 决策变更历史暴露的问题

从 `architecture-decision-2026-04.md` 记录的完整变更链：

```
初始方案: NestJS + OT + PostgreSQL/JSONB
    ↓
决策一: 纯 Rust (Axum) — 推翻了后端语言选型
    ↓
决策二: SQLite 替代 PostgreSQL — 推翻了数据库选型  
    ↓
决策三: Loro 替代 Yrs + PostgreSQL 替代 SQLite — 又推翻了决策二
```

三次重大架构变更，每次都触及基础设施层（语言、数据库、CRDT 库）。这本身就是**调研不足以支撑决策**的信号——如果每次新调研都能推翻前一版决策，说明之前的决策做得太早了。

### 1.2 决策二的教训：一个典型的案例

决策二（SQLite）的推导链条：

1. 看到 AppFlowy 用 Yrs + SQLite → 认为服务端 SQLite 是可行的
2. SQLite 单文件部署简单 → 比 PostgreSQL 轻量
3. 结论：服务端用 SQLite 做主存储

**但调研文档自己就发现了反证**——`crdt-sqlite-deep-research.md` 11.2 节明确写道：

> "没有找到以 SQLite 做服务端主存储的 CRDT 协作产品的生产案例"
> "AppFlowy-Cloud 使用 PostgreSQL + S3"

这个矛盾被记录在调研文档中，但仍然做出了 SQLite 的决策。结果决策三不得不改回 PostgreSQL。**如果当时调研再深入一步（直接看 AppFlowy-Cloud 的源码而非只看客户端），决策二根本不会发生。**

---

## 二、决策 vs 调研结论：三处自相矛盾

### 2.1 「纯 Rust 后端」 vs 自己的 Rust 调研

`rust-ecosystem-research.md` 是仓库中最扎实的文档（631 行，有 TechEmpower 基准、有代码对比、有效率量化）。其最终结论：

> "建议维持之前的渐进式混合架构策略。NestJS 快速上线，Rust 逐步替换性能热点。"

> "开发效率损失 40-60%"

> "全量 Rust 后端 (P3): **不推荐短期内实施**"

> "团队招聘: NestJS 容易（TS/JS 基数大），Rust 困难（开发者稀缺）"

但决策一直接推翻了这些，核心理由是"已引入 Rust（CRDT + 公式），消除双栈成本"。**实际情况是代码一行未写**——不存在"已引入"的技术债，这是一个虚拟的约束条件。如果按照调研自己的建议来，决策应该是：

```
短期: NestJS 全栈快速上线
中期: 公式引擎切换 Formualizer (Rust→WASM，收益最大)
长期: 根据实际瓶颈决定是否迁移其他模块
```

### 2.2 「Loro 替代 Yrs」 vs 自己的成熟度评估

`crdt-sqlite-deep-research.md` 第 8.5 节选型建议：

| 维度 | 短期（MVP） | 长期考虑 |
|------|-----------|---------|
| **推荐** | **Yrs** | 关注 Loro |
| **理由** | 生态成熟、AppFlowy 验证、前端 Yjs 无缝 | Loro 的 Move/Map/Shallow Snapshot 对多维表格更优 |

决策三将 Loro 提前到了短期方案。带来的新风险：

- Loro v1.0（2025.09 发布），生产验证极少
- `loro-extended` 由 SchoolAI 一家公司维护（bus factor = 1）
- Bundle 2.9MB（Yjs 84KB），对首屏加载的影响未经测试
- Rust 后端的 PG 持久化层需自行从 TS 移植

### 2.3 「PostgreSQL」 vs 「SQLite」之间的摇摆

决策变化：

```
初始: PostgreSQL + JSONB
  → 决策二: 改为 SQLite（理由：嵌入式零运维、AppFlowy 验证）
  → 决策三: 改回 PostgreSQL（理由：AppFlowy 云端实际用 PG）
```

暴露的问题：调研时没有区分 AppFlowy **客户端**用 SQLite 和 **服务端**用 PostgreSQL 的关键差异，导致了一次完全可以避免的决策回退。

---

## 三、技术栈复合风险

当前决策的技术栈组合：

| 组件 | 选择 | 成熟度 | 独立风险 |
|------|------|--------|---------|
| CRDT 库 | Loro v1.0 | 2025.09 首版，生产验证极少 | 中高 |
| 公式引擎 | Formualizer v0.3 | 早期版本，320 函数 | 中 |
| 前端 CRDT 框架 | loro-extended | SchoolAI 单公司维护 | 中高 |
| 后端语言 | 纯 Rust (Axum) | 框架成熟，但团队能力未知 | 中 |
| 数据库 | PostgreSQL | 最成熟 | 低 |

**单独看每个选择都有技术理由，但四个中高风险组件叠加在一起形成复合风险。** 任何一个组件遇到问题（Loro 有 bug、Formualizer 缺公式、loro-extended 停更），都可能阻塞整个项目。

对比一个保守方案的技术风险：

| 组件 | 保守选择 | 成熟度 | 独立风险 |
|------|---------|--------|---------|
| 实时协作 | OT（参考 APITable，TS 实现） | APITable 生产验证 | 低 |
| 公式引擎 | HyperFormula（JS） | 400+ 函数，成熟 | 低（许可证除外） |
| 后端 | NestJS（TS） | 生态成熟，招聘容易 | 低 |
| 数据库 | PostgreSQL + JSONB | 最成熟 | 低 |

保守方案的问题是 HyperFormula AGPL 许可证和可能的性能瓶颈——但这些问题可以在 PoC 阶段用实际数据验证，而不是在纸面上用 Rust 方案"预防"。

---

## 四、已识别但未填补的调研缺口

`crdt-sqlite-deep-research.md` 第 11.3 节自己列出了"尚未调研的关键问题"：

| 缺失项 | 重要度 | 当前状态 |
|--------|--------|---------|
| Canvas + CRDT 数据绑定 PoC | 高 | **零实践**——这是前端最复杂的集成点 |
| 中文全文搜索具体方案 | 高 | pg_jieba 只提了名字，从未测试 |
| 多租户隔离策略 | 中 | 完全没涉及 |
| 移动端 CRDT 同步 | 中 | 没涉及 |
| CRDT 文档导入/导出性能 | 中 | 没测试 |
| 自动化工作流在纯 Rust 中的实现 | 中 | 原方案基于 BullMQ(Node.js)，Rust 方案空白 |

此外，还存在以下基础性调研缺失：

### 4.1 团队能力评估

技术选型的第一个输入应该是**团队现有能力**，但整个仓库没有这方面的记录：
- 团队有几个后端开发？熟悉什么语言？
- 有没有人写过 Rust 生产代码？
- 有没有人深入用过 CRDT？
- 前端同学对 Canvas 渲染有多少经验？

### 4.2 MVP 范围定义

不同目标量级的架构完全不同：

| 目标 | 合理的架构 |
|------|-----------|
| 1 万行，10 人协作 | NestJS + PostgreSQL + 乐观锁足够，不需要 CRDT |
| 10 万行，50 人协作 | CRDT 开始有意义，但 Yjs 完全够用 |
| 100 万行，500 人协作 | 需要 Loro 级别的性能优化 |
| 1000 万行，1000 人协作 | 需要类似飞书的 MPP + 分层存储 |

当前决策假设了百万行级别的目标，但从未明确定义 MVP 范围。

### 4.3 Make vs Buy 分析

- **Fork APITable**：AGPL-3.0，代码完整，有 Canvas 渲染引擎 + OT 协作 + 插件系统。改造成本 vs 从零写，从未评估。
- **基于 NocoDB/Baserow/Teable 改造**：架构更简单（无 CRDT），适合轻量起步，也未评估。

### 4.4 竞品简单方案的深度分析

竞品分析集中在 Notion/飞书/APITable 三个最复杂的系统。以下项目的架构更接近一个团队从零起步的合理选择，但没有做深入分析：

| 项目 | 架构 | 为什么值得深入研究 |
|------|------|-------------------|
| **Baserow** | Django + PostgreSQL，无 CRDT | 证明了不需要 CRDT 也能做多维表格协作 |
| **NocoDB** | Node.js + MySQL/PG，无 CRDT | 最简架构，团队技术栈最接近 |
| **Teable** | NestJS + PostgreSQL | 号称"Postgres-native spreadsheet"，架构和我们初始方案高度一致 |
| **Grist** | SQLite + Python | 证明了单文件数据库也能做电子表格产品 |

### 4.5 缺少 PoC 验证

整个仓库 50+ 篇文档，没有一行可运行的代码。以下关键假设无法在纸面验证：

| 需要验证的假设 | 风险 |
|---------------|------|
| Canvas + Loro/Yjs 数据绑定在大数据量下是否流畅 | 如果不流畅，架构需要根本性改变 |
| Loro 2.9MB bundle 对首屏加载的实际影响 | 可能导致前端选型从 Loro 回退 |
| Rust Axum + Loro WebSocket 同步的实际延迟 | 理论值不等同于实测 |
| pg_jieba 中文分词效果 | 如果效果差，搜索方案需重选 |
| Formualizer WASM 在浏览器中的加载和执行耗时 | 可能放弃 WASM 公式而用服务端计算 |
| 单表 10 万行时 LoroDoc 的内存占用 | 影响热表缓存策略和部署规格 |

---

## 五、流程建议

### 5.1 核心原则

**决策 = 调研 × PoC 验证 × 团队能力匹配**，三者缺一不可。

当前流程：
```
调研(50%) → 决策 → 发现新信息 → 推翻决策 → 再调研 → 再决策
```

建议流程：
```
调研(100%) → PoC 验证 → 团队能力匹配 → 决策
```

### 5.2 具体建议

1. **暂停新增架构决策**：在 PoC 验证完成前，不再对已记录决策做方向性变更
2. **回归保守 baseline**：以 NestJS + PostgreSQL + OT（参考 APITable）作为实现基线，这是 APITable 已验证的路径
3. **隔离实验性技术**：Loro、Formualizer、纯 Rust 后端作为实验性技术，在独立分支/PoC 中验证，不与主线架构绑定
4. **明确定义 MVP 目标量级**：确定 V1 需要支持的行数、并发用户数、表数量
5. **优先级排序建议**：

| 优先级 | 任务 | 理由 |
|--------|------|------|
| P0 | Canvas 表格渲染 PoC（纯前端，无协作） | 这是整个产品最难的部分，必须先验证可行性 |
| P0 | 确定 MVP 目标量级 | 决定了是否需要 CRDT，以及用什么级别的架构 |
| P1 | 数据模型 PoC：PostgreSQL JSONB 读写性能 | 验证基础存储方案的性能边界 |
| P1 | 团队能力摸底 | 决定哪些技术选型是现实的 |
| P2 | 公式引擎对比 PoC：HyperFormula vs Formualizer WASM | 用实际公式测试，而非看文档对比 |
| P2 | CRDT 协作 PoC：最小化 WebSocket 同步 demo | 100 行 + 3 客户端即可验证核心假设 |
| P3 | 中文全文搜索 PoC：pg_jieba 实测 | 验证分词效果和查询性能 |
| P3 | 竞品简单方案深度分析（Baserow/NocoDB/Teable） | 为"是否需要 CRDT"提供参考 |

---

## 六、总结

当前仓库的调研工作在**广度上充分**（覆盖了多维表格几乎所有技术领域），但在**深度和验证上不足**（关键决策依赖未经验证的假设，且调研结论与最终决策之间存在矛盾）。

最需要警惕的是**复合风险**——Loro + Formualizer + loro-extended + 纯 Rust 后端，每个组件单独看都有合理的技术理由，但四个较新技术叠加在一起，对于一个零代码起点的项目来说风险过高。

**在没有任何 PoC 验证的情况下，建议不要对技术栈做最终锁定。** 先用最保守的方案（NestJS + PostgreSQL）把 Canvas 表格渲染跑起来，再根据实测数据逐个评估哪些组件需要替换。

---

## 参考

- `notes.md` — 当前技术决策记录
- `tech-architecture/architecture-decision-2026-04.md` — 三轮决策变更记录
- `tech-architecture/rust-ecosystem-research.md` — Rust 生态调研（含开发效率对比）
- `tech-architecture/crdt-sqlite-deep-research.md` — CRDT+SQLite 调研（含自检缺口）
- `tech-architecture/loro-postgresql-architecture-research.md` — Loro+PG 架构调研
- `tech-architecture/crdt-vs-ot-deep-research.md` — CRDT vs OT 深度研究
- `open-source-projects/competitive-deep-analysis.md` — 竞品技术分析
