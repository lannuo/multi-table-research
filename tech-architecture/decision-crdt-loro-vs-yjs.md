# 决策分析：CRDT 选型 — Loro vs Yjs/Yrs

> 日期: 2026-04-24
> 背景: 全功能多维表格，solo 开发，需支持行列拖拽、公式、版本控制、离线编辑
>
> **2026-04-24 补充**: 决策回顾审查指出（`review-decision-docs.md`），50 人并发场景下竞品证明了 CRDT 不是必需品。此文档补充说明：选 Loro 的根本原因不是"50 人协作需要 CRDT"，而是 Loro 的三个原生能力恰好覆盖了产品的三个核心需求。详见第一节。

---

## 一、结论先行

**选 Loro。**

不是因为 benchmark 数字好看，而是因为 Loro 的原生能力（MovableList + Shallow Snapshot + Git-like DAG）恰好覆盖了多维表格的三个核心功能：行列拖拽排序、大文档内存管理、版本历史。用 Yjs 实现这些不是不可能，但每一项都需要大量自定义代码，而 Loro 是内建的。

---

## 二、关键差异化能力

### 2.1 MovableList → 行列拖拽排序

多维表格的行拖拽排序是基础操作。用户拖动第 3 行到第 7 行。

**Yjs 方案**：Delete+Insert+Testament（继承链）。Bartosz Sypytkowski 专门写了一篇文章讲这个方案，复杂度远超直觉。并发移动时需要 Testament 记录移动源和目标，LWW 选择结果。

**Loro 方案**：`MovableList` 原生 `move()` API。并发移动时每个元素天然只占一个位置。

这一项就基本排除了 Yjs——行列拖拽是全功能表格的必备特性，实现复杂度差异太大。

### 2.2 Shallow Snapshot → 大文档内存管理

10 万行表格的 CRDT 文档可能 50-150MB。服务端不能无限内存。

**Yjs 方案**：自建快照轮转。定期全量快照，丢弃旧操作日志。在应用层管理生命周期。

**Loro 方案**：`export(ShallowSnapshot)` 内建支持，类似 Git shallow clone。只保留最近 N 层历史和当前完整状态。

代码量差异：Yjs 方案需要数百行管理逻辑，Loro 一行 API 调用。

### 2.3 Git-like DAG → 版本历史

全功能产品需要版本历史——"回到昨天下午 2 点的版本"。

**Yjs 方案**：自建快照版本管理。服务器定期存全量快照，版本回退 = 加载快照替换当前文档。

**Loro 方案**：`doc.fork_at(frontiers)` + `doc.checkout(frontiers)` 内建支持。DAG 结构天然支持分支和时间旅行。

### 2.4 Map 操作性能 → 单元格编辑

每次单元格编辑 = 一次 Map set。Loro 并发 Map set 100K = 488ms vs Yjs 31,598ms（**65x**）。这不是理论差异，直接体现为用户编辑响应时间。

---

## 三、Yjs 的优势不关键

| Yjs 优势 | 为什么对全功能产品不那么重要 |
|---------|--------------------------|
| 84KB bundle | Loro 2.9MB 可通过按需加载、CDN、HTTP/2 push 缓解。首次加载后缓存 |
| 2015 年起成熟 | Loro v1.0 虽然是 2025.09，但核心算法经过严格学术验证 |
| 社区大、文档多 | 我们不需要社区——需要的是减少自定义代码量 |
| AppFlowy 用 Yrs | AppFlowy 也验证了 CRDT+表格的可行性，但他们没有 MovableList，也没有内建版本控制 |
| Yrs 有 Rust 服务端 | Loro 原生就是 Rust，crate 直接可用。服务端不需要 WASM |

---

## 四、loro-extended 的额外价值

`loro-extended`（SchoolAI/MIT 许可）提供的不是一个 CRDT 库，而是一个应用层框架：

| 模块 | 节省的开发量 |
|------|------------|
| `@loro-extended/react`：useDocument, useValue, usePresence Hooks | React 集成层（数百行） |
| `@loro-extended/adapter-postgres`：PG 持久化适配器 | 数据库持久化逻辑（数百行） |
| `@loro-extended/adapter-indexeddb`：浏览器离线存储 | 离线存储层（数百行） |
| `@loro-extended/adapter-websocket`：WebSocket 同步 | 实时同步层（数百行） |
| `@loro-extended/change`：Schema-First 类型安全操作 | 类型定义层 |

总计节省约 **2,000-3,000 行胶水代码**。对于 solo 开发者，这是决定性的。

---

## 五、风险与缓解

| 风险 | 缓解 |
|------|------|
| Loro v1.0 较新，可能遇 bug | MIT 许可，可自行修复或回报上游。团队活跃 |
| loro-extended 由 SchoolAI 单公司维护 | MIT 许可，核心 CRDT 是 Loro（独立项目）。他们的 PG 适配器代码量小，可自维护 |
| Bundle 2.9MB | 按需加载 + CDN + gzip（894KB）+ HTTP/2 push。首屏之后浏览器缓存 |
| Rust 后端需自建持久化 | Loro crate 提供 `export/import` API；参考 loro-extended TS 实现移植到 Rust sqlx |

---

## 六、Yjs 的一个潜在用途

前端 SDK（bundle 敏感场景）可以考虑用 Yjs 提供轻量客户端，服务端用 Loro。但 loro-extended 已经提供了 React 集成，这个需求对我们不存在。

---

## 参考

- `tech-architecture/crdt-vs-ot-deep-research.md` — CRDT vs OT 深度对比
- `tech-architecture/crdt-sqlite-deep-research.md` — Yrs 能力与限制（8.5 节选型建议）
- `tech-architecture/loro-postgresql-architecture-research.md` — Loro 深度评估（第二节性能对比）
- [Loro v1.0 Blog](https://loro.dev/blog/v1.0)
- [Loro Performance Benchmarks](https://loro.dev/docs/performance)
- [loro-extended GitHub](https://github.com/SchoolAI/loro-extended)
