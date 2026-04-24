# 决策分析：公式引擎长期选型

> 日期: 2026-04-24
> 背景: 全功能多维表格，需要 300+ Excel 兼容函数、依赖图增量重算、WASM 浏览器端计算

---

## 一、结论先行

**选 Formualizer (Rust+WASM, MIT/Apache-2.0)。**

这是唯一同时满足以下条件的方案：
- 许可证商用友好（排除 HyperFormula AGPL）
- 320+ Excel 兼容函数（排除 IronCalc 的函数覆盖）
- WASM 浏览器端计算（排除纯服务端方案）
- Rust 核心，性能足够（符合飞书的验证方向）

代价是接受 v0.3 的不成熟。但考虑到没有更好的替代方案，以及 MIT 许可允许自行修复，这是可控的风险。

---

## 二、候选方案

### 2.1 HyperFormula — 功能最全但许可证致命

| 维度 | 评价 |
|------|------|
| 函数数量 | ~400 (Excel 兼容度高) |
| 许可证 | **AGPL-3.0**（或购买商业许可） |
| 增量重算 | 有（依赖图 + 拓扑排序） |
| 服务端 | JS only（V8 限制） |
| WASM | 不支持 |

**结论**：AGPL 排除。除非购买商业许可，但 Handsontable 未公开价格。

### 2.2 Formualizer — 架构最先进但不成熟

| 维度 | 评价 |
|------|------|
| 函数数量 | **320+** (Excel 兼容) |
| 许可证 | **MIT / Apache-2.0**（双许可） |
| 增量重算 | 有（依赖图 + 动态数组 + Undo/Redo） |
| WASM | 支持两种模式：`portable-wasm` + `wasm-js` |
| 服务端 | 原生 Rust — 零跨语言开销 |
| 存储 | Apache Arrow 列式存储 |
| 版本 | v0.3+（npm 同步发布） |
| 架构 | formualizer-eval (计算引擎+依赖图) + formualizer-parse (解析器+AST) + formualizer-sheetport (表格 API) |

**风险**：v0.3 是早期版本。以下是已知和未知：

| 风险 | 分析 |
|------|------|
| API 不稳定 | 可能。但核心计算逻辑（解析+求值）不太会大变 |
| 函数 bug | 可能。320 个函数中的边缘情况需要实际使用中验证 |
| 缺少的 ~80 个函数 | 需要评估缺的是不是高频函数 |
| 社区小 | 贡献者少，遇到问题需要自己解决 |
| WASM bundle 大小 | 需实测（Rust WASM 模块通常 200KB-2MB gzipped） |

### 2.3 IronCalc — 保守备选

| 维度 | 评价 |
|------|------|
| 函数数量 | 基础（路线图：数组公式、条件格式） |
| 许可证 | **MIT / Apache-2.0** |
| 版本 | v0.7.1（目标 v1.0 mid-2026） |
| WASM | 不支持（当前） |
| 定位 | 轻量、最小依赖、高测试覆盖率 |

**结论**：当前函数覆盖不足。v1.0 后可能成为 Formualizer 的替代方案。

### 2.4 Teable SQL 方案 — 不适合全功能产品

Teable 的 ANTLR4 → SQL 编译方案很聪明，但有根本局限性：
- SQL 表达电子表格函数能力有限（78 函数 vs 320+）
- 复杂公式（如嵌套 IF、VLOOKUP、数组公式）在 SQL 中难以表达
- 跨表引用、关联汇总等高级功能 SQL 复杂度指数级增长

全功能产品需要电子表格级别的公式丰富度，SQL 不是合适的选择。

---

## 三、Formualizer 的架构验证

Formualizer 的设计对多维表格场景是天然适配的：

```
服务端 (Rust 原生):
  Formualizer → 读取 LoroDoc → 批量重算 → 返回结果
  （用于仪表盘聚合、自动化触发后的公式链计算）

浏览器端 (WASM):
  Formualizer WASM → 读取 Loro Doc → 增量重算 → Canvas 更新
  （用于实时编辑时的即时公式反馈）
```

这与飞书的"Rust 引擎服务端 + WASM 客户端"架构完全一致。

关键优势：**一份代码，两端运行**——公式定义在浏览器和服务器上产生相同结果。

---

## 四、函数缺口评估

Formualizer 320 vs HyperFormula ~400，差约 80 个。但需要区分**高频函数**和**低频函数**：

**高频函数（Formualizer 大概率支持）**：
SUM, IF, COUNT, AVERAGE, VLOOKUP, CONCATENATE, DATE, TODAY, LEFT, RIGHT, MID, TRIM, LEN, UPPER, LOWER, ROUND, MIN, MAX, ABS, AND, OR, NOT, COUNTIF, SUMIF, INDEX, MATCH

**可能缺失的函数（需要验证）**：
XLOOKUP, FILTER, SORT, UNIQUE, LAMBDA, LET, TEXTJOIN, IFS, SWITCH, RANDARRAY, SEQUENCE, STOCK

**策略**：在写第一行业务代码之前，用 100 个高频公式做兼容性测试。通过率 ≥ 90% → 可用；< 90% → 触发 Plan B。

---

## 五、Plan B 与风险缓解

### 5.1 回退方案（按优先级）

| 优先级 | 方案 | 代价 |
|--------|------|------|
| 1 | 贡献给 Formualizer 上游修复缺失函数 | 时间不确定，但最可持续 |
| 2 | 服务端计算（IronCalc 或自定义 Python 公式引擎），前端展示结果 | 失去 WASM 前端计算的低延迟优势，弱网场景体验下降 |
| 3 | **HyperFormula 商业许可** | 需要询价 |

### 5.2 HyperFormula 商业化可能性

HyperFormula 由 Handsontable 维护。Handsontable 商业许可起价约 **$790/developer/年**（2024 年定价参考，非精确报价）。

**决策规则**：如果 HyperFormula 独立许可年费 < $2,000，且 Formualizer 公式测试通过率 < 90%，应直接购买 HyperFormula 许可。$2,000/年远低于自行修复 Formualizer 缺失函数 + 长期维护的时间成本（以 solo 开发者的有效时薪计算）。

### 5.3 Handsontable 联系方式

需要直接联系 Handsontable 销售获取 HyperFormula 的独立许可价格和条款：sales@handsontable.com。这个查询应在 Formualizer 公式测试完成前进行。

---

## 六、结论

**选 Formualizer。** 核心逻辑：

1. 许可证是硬约束——HyperFormula AGPL 不可用
2. 全功能产品需要公式丰富度——IronCalc 当前不够
3. 架构方向验证——飞书同样用 Rust 公式引擎 + WASM
4. 风险可管理——MIT 许可允许自行修复，核心功能已可用

**但不是"定了就完事"**——需要在开发早期做实际的公式兼容性测试，确认 320 个函数中对我们最重要的 100 个能正确运行。

---

## 参考

- `tech-architecture/rust-formula-engine-research.md` — Formualizer/IronCalc 详细对比
- `tech-architecture/feishu-bitable-architecture.md` — 飞书 Rust 公式引擎架构
- `open-source-projects/simple-architecture-analysis.md` — Teable SQL 方案对比
- [Formualizer GitHub](https://github.com/PSU3D0/formualizer)
- [IronCalc GitHub](https://github.com/ironcalc/IronCalc)
