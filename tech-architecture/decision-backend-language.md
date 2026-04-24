# 决策分析：后端语言 — NestJS (TS) vs Rust (Axum)

> 日期: 2026-04-24
> 背景: 全功能多维表格，solo 开发，CRDT 选 Loro，公式引擎待定

---

## 一、结论先行

**选 NestJS (TypeScript)。**

不是因为 TypeScript 更好，而是因为 solo 开发者的核心瓶颈是**功能交付速度**，不是运行时性能。Rust 的 1.3-1.5x 开发效率差距，乘以全功能产品的需求数量，意味着数月的额外开发时间。

这不是反对 Rust——Rust 在正确的场景下是绝对正确的选择。但我们的场景是：一个人，要从零交付一个功能齐全的产品。在这种约束下，开发效率是第一优先级。

---

## 二、关键约束

### 2.1 团队规模 = 1

`rust-ecosystem-research.md` 的量化数据：

| 指标 | TypeScript | Rust | 倍率 |
|------|-----------|------|------|
| 开发交付周期 | 最快 | 较慢 | **Rust 约 1.3-1.5x** |
| CRUD API 开发 | 1x（基准） | 1.5-2x | — |
| WebSocket 实时通信 | 1x | 1.3-1.5x | — |
| JSON 操作 | 天然优势 | 需 serde | — |
| 公式引擎 | — | **0.8x（Formualizer Rust 原生）** | 唯一的例外 |

对于一个团队，1.3x 差距可以通过增加人力弥补。对于一个人，**这就是多几个月开发时间**。

### 2.2 Loro 可以在 Node.js 中使用

选 Loro CRDT 不强制 Rust 后端。Loro 提供 JS/WASM 绑定，`loro-extended` 的 PG 适配器就是 TypeScript 写的，在 Node.js 中运行。

```
服务端 NestJS + Loro WASM 绑定 → 与前端共享同一份 CRDT 逻辑
```

不存在"因为选了 Loro 所以后端必须是 Rust"的依赖关系。

---

## 三、Rust 的真正优势在哪里

| Rust 优势 | 在全功能产品中的实际价值 |
|-----------|----------------------|
| API 延迟 5-10x 更低 (P99) | 用户感知不到 5ms vs 50ms 的差异 |
| 内存占用 5-10x 更低 | Docker 多配点内存比 Rust 省的时间便宜 |
| 无 GC 停顿 | CRUD API 不是延迟敏感型 |
| 编译期消除 bug | TypeScript 严格模式 + 测试也能做到大部分 |
| **公式引擎性能** | **这是唯一的硬需求——千万行公式计算需要 Rust** |

对全功能多维表格来说，**公式引擎是唯一真正需要 Rust 的地方**。其余 CRUD/权限/WebSocket/自动化——NestJS 完全胜任。Teable（18K stars）就是证明。

---

## 四、Teable = 活证据

Teable 用 NestJS + PostgreSQL，实现了：
- 百万行级别表格，标准操作 < 100ms
- 多人实时协作（WebSocket + OT-like）
- 公式引擎（ANTLR4 → SQL 编译，对 Teable 来说够用）
- 权限、导入导出、多视图

如果 Teable 能做到这些，没有理由说 NestJS 不能支撑我们的产品。

---

## 五、公式引擎的解耦方案

公式引擎的选择可以独立于后端语言：

```
方案 1: Formualizer WASM 在浏览器计算（推荐）
  前端: Loro CRDT 变更 → Formualizer WASM 重算 → UI 更新
  后端: 只存公式定义和原始数据，不参与计算
  
方案 2: 后端 Rust 微服务计算
  NestJS 主服务 → HTTP/gRPC → Rust 公式计算服务
  仅当需要服务端批量重算时调用
```

方案 1 对 solo 开发者最友好——不需要维护第二个服务。这也是飞书的方向（客户端 WASM SQLite + Rust 公式引擎）。

---

## 六、但 Rust 在视野内

决策不是"TS 还是 Rust"，而是"先 TS，何时引入 Rust"。

| 触发条件 | 引入方式 |
|---------|---------|
| 公式引擎需要后端批量计算 | Rust 公式微服务（napi-rs 或独立 HTTP） |
| CRDT 同步需要极致性能 | Rust Axum + loro crate 作为同步服务 |
| 导入/导出成为瓶颈 | Rust CSV/Excel 处理模块 |

但这些都是**找到瓶颈后**的优化，不是起步阶段的架构选择。

---

## 七、推荐技术栈

```
前端:    React + Next.js + Canvas 渲染 + Loro WASM + Formualizer WASM
后端:    NestJS (TypeScript) + PostgreSQL + Redis
  ├──   RESTful API (业务逻辑)
  ├──   WebSocket (Loro CRDT 同步, 通过 Loro WASM 绑定)
  └──   公式引擎 (前端 WASM 为主, 后端可选 Rust 微服务)
数据库:  PostgreSQL (JSONB 混合模型) + Redis (缓存/队列)
文件:    MinIO / S3
```

这基本上就是我们**最初的方案**（`tech-stack-selection.md` 的方案 A），只是：
- OT → Loro CRDT
- HyperFormula → Formualizer WASM
- 其余不变

一个经历了多轮调研后回归的结论，不丢人。

---

## 参考

- `tech-architecture/rust-ecosystem-research.md` — Rust 生态深度调研（含 NestJS vs Rust 效率对比）
- `tech-architecture/tech-stack-selection.md` — 初始技术选型方案（方案 A: TS 全栈）
- `open-source-projects/simple-architecture-analysis.md` — Teable 架构分析
- `tech-architecture/feishu-bitable-architecture.md` — 飞书架构（含 WASM SQLite + Rust 公式集成）
