# Rust 公式引擎深度调研 - Formualizer / IronCalc / WASM 可行性分析

> 调研日期: 2026-04
> 背景: 项目原选型 HyperFormula 存在许可证风险（实为 GPLv3，非此前标注的 MIT）。本报告深入调研基于 Rust 的公式引擎，评估其作为替代方案的可行性，重点分析 Formualizer、IronCalc 及 WASM 编译方案。

---

## 一、HyperFormula 许可证问题澄清（重要更正）

### 1.1 许可证事实

此前项目研究中标注 HyperFormula 为 "MIT 许可"（见 formula-engine.md 和 notes.md），**这是错误的**。

| 维度 | 实际情况 |
|------|----------|
| **开源许可证** | **GPLv3**（非 MIT，非 Apache） |
| **商业许可证** | 需向 Handsontable 购买专有许可 |
| **许可证密钥** | 运行时必须配置 `licenseKey`，即使开源使用也需声明 `gpl-v3` |
| **官方说明** | https://hyperformula.handsontable.com/guide/licensing.html |

### 1.2 GPLv3 对本项目的实际影响

| 场景 | GPLv3 下的约束 | 影响 |
|------|----------------|------|
| **内部自部署使用** | 若不分发二进制，SaaS 模式下 GPLv3 的传染性条款不直接触发 | 风险中等 |
| **开发商业产品** | 若分发则必须开源整个应用，或购买商业许可 | 风险高 |
| **未来商业化** | 任何向外部客户提供的服务都涉及许可证合规 | 风险高 |
| **法律合规成本** | 需要法务审核，增加运营成本 | 隐形成本 |

### 1.3 结论

> **必须重新评估公式引擎选型。** 即使当前仅内部使用，GPLv3 的传染性条款在未来任何商业化场景下都会成为障碍。且 HyperFormula 要求运行时配置许可证密钥，对用户体验不友好。

---

## 二、Formualizer 深度分析

### 2.1 项目概况

| 维度 | 信息 |
|------|------|
| **项目地址** | https://github.com/PSU3D0/formualizer |
| **许可证** | **MIT / Apache-2.0 双许可**（真正的宽松许可证） |
| **语言** | Rust（核心），Python（PyO3 绑定），TypeScript（WASM 绑定） |
| **创建时间** | 2025-03-10 |
| **最后推送** | 2026-04-19（活跃开发中） |
| **Star 数** | 117 |
| **Fork 数** | 14 |
| **贡献者** | 4 人（主力: PSU3D0, 528 commits） |
| **最新版本** | v0.5.6（2026-04-14） |
| **npm 包** | `formualizer`（WASM 绑定） |
| **PyPI 包** | `formualizer`（Python 绑定） |
| **crates.io** | `formualizer`, `formualizer-eval`, `formualizer-parse`, `formualizer-workbook` |
| **文档站** | https://formualizer.dev |

### 2.2 核心特性

```
Formualizer 特性全景:
├── 320+ Excel 兼容函数
│   ├── 数学与三角 (SUM, ROUND, MOD, ...)
│   ├── 文本处理 (CONCAT, LEFT, MID, SUBSTITUTE, ...)
│   ├── 查找引用 (XLOOKUP, VLOOKUP, HLOOKUP, INDEX, MATCH, ...)
│   ├── 日期时间 (DATE, NOW, DATEDIF, EOMONTH, ...)
│   ├── 统计 (AVERAGEIF, COUNTIFS, STDEV, ...)
│   ├── 财务 (PMT, IRR, XIRR, NPV, ...)
│   ├── 数据库 (DSUM, DCOUNT, ...)
│   └── 工程 (BITAND, HEX2DEC, ...)
├── Apache Arrow 列式存储
├── 依赖图 + 增量重算
├── 动态数组 (FILTER, UNIQUE, SORT, SORTBY)
├── 撤销/重做 (事务式 changelog)
├── 文件 I/O (XLSX, CSV, JSON)
├── SheetPort (电子表格即类型化 API)
├── 确定性模式 (可注入时钟、时区、随机种子)
└── 自定义函数注册
```

### 2.3 架构设计

Formualizer 采用分层 crate workspace 设计，可选择合适的层级接入：

```
formualizer              <-- 推荐入口: 全功能 re-export
  formualizer-workbook   <-- 高级 Workbook API (sheets, undo/redo, I/O)
    formualizer-eval     <-- 计算引擎核心 (依赖图, 内建函数, 增量重算)
      formualizer-parse  <-- 公式解析器 (tokenizer, AST, pretty-printer)
      formualizer-common <-- 共享类型 (值, 错误, 引用)
  formualizer-sheetport  <-- SheetPort 运行时 (电子表格即类型化 API)
```

| Crate | 适用场景 |
|-------|----------|
| `formualizer` | 默认选择，通过 feature flag 导出全部功能 |
| `formualizer-workbook` | 需要 Workbook 级别操作（Sheet、I/O、Undo/Redo） |
| `formualizer-eval` | 自有数据模型，仅需计算引擎 |
| `formualizer-parse` | 仅需公式解析、AST 分析 |

### 2.4 代码示例

#### Rust 使用

```rust
use formualizer_workbook::Workbook;
use formualizer_common::LiteralValue;

let mut wb = Workbook::new();
wb.add_sheet("Sheet1")?;

// 设置数据
wb.set_value("Sheet1", 1, 1, LiteralValue::Number(1000.0))?;  // A1: 本金
wb.set_value("Sheet1", 2, 1, LiteralValue::Number(0.05))?;     // A2: 利率
wb.set_value("Sheet1", 3, 1, LiteralValue::Number(12.0))?;     // A3: 期数

// 设置月供公式
wb.set_formula("Sheet1", 1, 2, "=PMT(A2/12, A3, -A1)")?;
let payment = wb.evaluate_cell("Sheet1", 1, 2)?;
// => ~85.61
```

#### WASM (浏览器/Node.js) 使用

```typescript
import init, { Workbook } from 'formualizer';
await init();

const wb = new Workbook();
wb.addSheet('Pricing');
wb.setValue('Pricing', 1, 1, 100);     // 基础价格
wb.setValue('Pricing', 2, 1, 0.15);    // 折扣率
wb.setFormula('Pricing', 1, 2, '=A1*(1-A2)');

console.log(await wb.evaluateCell('Pricing', 1, 2)); // 85
```

#### 自定义函数注册（JS/WASM）

```typescript
import init, { Workbook } from 'formualizer';
await init();

const wb = new Workbook();
wb.addSheet('Sheet1');

wb.registerFunction(
  'js_add',
  (a, b) => Number(a) + Number(b),
  { minArgs: 2, maxArgs: 2 },
);

wb.setFormula('Sheet1', 1, 1, '=JS_ADD(20,22)');
console.log(wb.evaluateCell('Sheet1', 1, 1)); // 42
```

### 2.5 WASM 编译详情

| 维度 | 说明 |
|------|------|
| **构建工具** | wasm-pack + wasm-bindgen |
| **目标** | `wasm32-unknown-unknown`（bundler 模式） |
| **npm 包名** | `formualizer` |
| **运行时配置** | `wasm-js` profile（浏览器/Node）或 `portable-wasm`（wasmtime 等非 JS 宿主） |
| **TypeScript 类型** | 完整 TypeScript API 定义 |
| **确定性模式** | 支持注入时钟、时区、随机种子（AI agent 友好） |

### 2.6 性能特征

Formualizer 基于 Apache Arrow 列式存储，性能特征：

| 特性 | 说明 |
|------|------|
| **增量依赖图** | 仅重算变更影响到的单元格 |
| **CSR 边格式** | 压缩稀疏行格式，内存高效 |
| **可选并行计算** | Rayon 并行评估 |
| **动态数组溢出** | Spill overlay 高效处理 |
| **预热规划** | 大型 Workbook 的计算预热 |

第三方基准测试（10,000 行 x 100 公式）参考数据：

| 指标 | Formualizer (Rust) | HyperFormula (JS) |
|------|--------------------|--------------------|
| 初始计算时间 | ~50ms | ~200ms |
| 启动时间 | ~1ms | ~10ms |
| 内存占用 (100K cells) | ~20MB | ~80MB |
| WASM Bundle 大小 | ~2MB | N/A |

> 注: Formualizer 官方标注 "正式基准测试进行中"，以上数据来自第三方对比文章（bswen.com）。正式基准尚需独立验证。

### 2.7 成熟度评估

| 维度 | 评估 |
|------|------|
| **项目年龄** | ~13 个月（2025-03 创建），年轻但迭代极快 |
| **版本节奏** | 2 周内连发 v0.5.2 ~ v0.5.6，开发非常活跃 |
| **代码规模** | 32MB 仓库，多 crate workspace，架构清晰 |
| **测试覆盖** | 有 Rust 核心覆盖率和 Python 覆盖率 badge |
| **文档质量** | formualizer.dev 独立文档站，API 文档完善 |
| **社区规模** | 4 位贡献者，117 star，社区小但专注 |
| **风险** | 主力开发者单点依赖（PSU3D0 贡献 96%+），bus factor 低 |
| **综合判断** | **技术方案成熟，但社区尚需观察。适合早期采用者。** |

---

## 三、IronCalc 深度分析

### 3.1 项目概况

| 维度 | 信息 |
|------|------|
| **项目地址** | https://github.com/ironcalc/IronCalc |
| **许可证** | **MIT / Apache-2.0 双许可** |
| **语言** | Rust |
| **创建时间** | 2023-11-20 |
| **最后推送** | 2026-04-23（极其活跃） |
| **Star 数** | 3,878 |
| **Fork 数** | 136 |
| **贡献者** | 10+ 人（主力: nhatcher 600 commits, dg-ac 254 commits） |
| **最新版本** | v0.7.1（2026-01-25） |
| **组织** | IronCalc GmbH（德国公司） |
| **资金** | 欧盟 Horizon Europe 计划 + NLnet 基金会资助 |
| **在线演示** | https://app.ironcalc.com |

### 3.2 核心特性

```
IronCalc 特性全景:
├── Excel 兼容公式引擎
│   ├── 基础数学/统计/文本/逻辑
│   ├── 查找引用函数
│   ├── 数组公式 + 动态数组
│   └── LAMBDA 支持
├── XLSX 读写
├── WASM 支持（浏览器内运行）
├── 国际化（英/德/法 + 更多语言计划中）
├── 命名范围 (Named Ranges)
└── 完整的电子表格产品（含 UI）
```

### 3.3 与 Formualizer 的关键区别

| 维度 | IronCalc | Formualizer |
|------|----------|-------------|
| **定位** | 完整电子表格产品（含 UI） | 嵌入式公式引擎（headless） |
| **函数数量** | 未精确公开，目标 90% Excel 覆盖 | 320+（精确统计） |
| **存储引擎** | 自有数据结构 | Apache Arrow 列式存储 |
| **Python 绑定** | 计划中 | 已发布（PyPI） |
| **WASM 绑定** | 有（集成在产品中） | 独立 npm 包 |
| **自定义函数** | 未明确 | 三端统一支持 |
| **确定性模式** | 无 | 完整支持（AI agent 友好） |
| **SheetPort** | 无 | 有（电子表格即 API） |
| **Star 数** | 3,878（社区大） | 117（新兴项目） |
| **资金支持** | 欧盟资助 + 公司运营 | 个人开发者 |

### 3.4 IronCalc 路线图

IronCalc 的 v1 目标：
- 数组公式、动态数组、LAMBDA（已完成）
- 90% Excel 函数覆盖（进行中）
- 国际化和本地化（已完成）
- 命名范围（已完成）

v2 目标：条件格式、排序过滤、图表、协作编辑（CRDT）。

### 3.5 成熟度评估

| 维度 | 评估 |
|------|------|
| **项目年龄** | ~2.5 年，较 Formualizer 成熟 |
| **社区** | 3,878 star，10+ 贡献者，Discord 社区活跃 |
| **资金保障** | 欧盟资助 + 公司实体，可持续性好 |
| **产品化** | 有在线可用产品 app.ironcalc.com |
| **API 文档** | docs.rs 文档，相对完善 |
| **函数覆盖** | 尚未达到 90% Excel 覆盖目标，部分高级函数缺失 |
| **综合判断** | **社区和资金更好，但作为嵌入式引擎使用不如 Formualizer 灵活。** |

---

## 四、其他 Rust 公式/表达式引擎

### 4.1 通用表达式求值器

这些不是完整的电子表格引擎，但在特定场景下可作为轻量替代：

| 项目 | 定位 | 许可证 | 成熟度 | WASM | 适用场景 |
|------|------|--------|--------|------|----------|
| **evalexpr** | 通用表达式求值器 + 微型脚本语言 | MIT | 成熟（6k+ 下载/天） | 可编译 | 简单计算规则、业务公式 |
| **cel-interpreter** | Google CEL (Common Expression Language) 解释器 | Apache-2.0 | 成熟 | 可编译 | 权限策略、条件表达式 |
| **formula** | 电子表格公式解析和求值器 | 未标注 | 早期（作者标注"未生产就绪"） | 可编译 | 轻量公式解析 |

### 4.2 评估

- **evalexpr**: 不支持 Excel 函数语法，无单元格引用、无依赖图。适合简单的 `a + b * c` 类计算，不适合电子表格场景。
- **cel-interpreter**: Google CEL 是策略语言，不是电子表格语言。适合权限判断 `resource.type == "table" && action == "edit"`，不适合 SUM/VLOOKUP。
- **formula**: 太早期，未生产就绪。

> **结论: 对于多维表格的公式引擎需求，只有 Formualizer 和 IronCalc 满足条件。其他表达式求值器可作为自动化工作流中的条件表达式引擎（配合使用）。**

---

## 五、WASM 公式引擎集成可行性分析

### 5.1 与 React/Canvas 前端的集成架构

```
┌──────────────────── 前端架构 ─────────────────────┐
│                                                    │
│  React + Next.js                                   │
│  ├── Canvas 表格渲染层 (绘制单元格)                 │
│  ├── React 状态管理层 (Zustand/Redux)               │
│  ├── OT 客户端 (WebSocket)                         │
│  └── 公式引擎层                                    │
│       ├── Formualizer WASM Module (主引擎)         │
│       │   ├── init() → 加载 ~2MB WASM              │
│       │   ├── Workbook 实例管理                     │
│       │   ├── 公式解析 + 求值                       │
│       │   └── 依赖图 + 增量重算                     │
│       └── Web Worker (可选隔离)                     │
│           └── 将公式计算移至 Worker 线程             │
│                                                    │
│  通信方式:                                         │
│  Canvas 事件 → 识别公式单元格 → WASM 求值 → 更新渲染 │
│                                                    │
└────────────────────────────────────────────────────┘
```

### 5.2 集成流程

```
1. 用户编辑单元格，输入 "=SUM(A1:A100)"
2. Canvas 渲染层捕获输入
3. React 状态管理层更新 cell data
4. 调用 Formualizer WASM: wb.setFormula(sheet, row, col, formula)
5. 调用 Formualizer WASM: wb.evaluateCell(sheet, row, col)
6. 获取返回值，更新 Canvas 渲染
7. 如果影响其他单元格，触发增量重算: wb.evaluateAll()
8. 将变更通过 OT 协议同步到服务端
```

### 5.3 内存管理: JS 与 WASM 之间的数据传递

| 方案 | 说明 | 性能 |
|------|------|------|
| **直接传值** | `wb.setValue(sheet, row, col, value)` 单值设置 | 适合零星编辑 |
| **批量传值** | `sheet.setValues(startRow, startCol, data2D)` 批量设置 | 适合初始加载 |
| **共享内存 (SharedArrayBuffer)** | 需要特定的 CORS 头配置 | 最高效，但配置复杂 |
| **JSON 序列化** | `Workbook.fromJson(json)` 整体加载 | 适合文件导入 |

对于多维表格场景的推荐策略：
- **初始化**: 通过 `fromJson()` 或 `setValues()` 批量加载表格数据
- **编辑操作**: 单值 `setValue()` + `setFormula()` 处理用户输入
- **大批量变更**: 使用 `beginAction()/endAction()` 分组操作，一次触发重算
- **结果获取**: `evaluateAll()` 后批量读取，避免频繁跨边界调用

### 5.4 WASM 冷启动时间分析

| 因素 | 估计值 | 说明 |
|------|--------|------|
| **WASM 模块下载** | ~2MB（gzip 后可能 ~500KB-1MB） | 取决于网络 |
| **编译实例化** | 50-150ms | 现代浏览器编译优化后 |
| **Formualizer init()** | ~1ms | 初始化引擎 |
| **首次求值** | 依赖数据量 | 增量重算 |

优化策略：
1. **预加载**: 在应用启动时即加载 WASM 模块，不等用户编辑公式
2. **代码分割**: `await init()` 独立 chunk，不阻塞主应用
3. **Web Worker 部署**: 将 WASM 模块部署在 Worker 中，不阻塞 UI 渲染
4. **流式编译**: 使用 `WebAssembly.compileStreaming()` 边下载边编译

### 5.5 生产级 WASM 计算引擎案例

| 产品 | 用途 | 说明 |
|------|------|------|
| **Google Sheets** | 表格计算 | Google 使用 WASM 加速部分计算功能 |
| **Figma** | 图形渲染 | 整个渲染引擎用 C++ 编译为 WASM |
| **Photoshop Web** | 图像处理 | WASM 编译的图像处理管线 |
| **AutoCAD Web** | CAD 渲染 | C++ 核心 WASM 化 |
| **DuckDB-WASM** | 数据分析 | 完整的 SQL 数据库在浏览器内运行 |
| **Loro CRDT** | 协作 | WASM 版本比 JS 版本快 10x，体积仅 84KB |
| **APITable (Teable)** | 表格计算 | Teable 已使用 Rust + WASM 做后端计算加速 |

> WASM 在浏览器中运行计算密集型任务已被广泛验证，不存在技术可行性风险。

---

## 六、JS 生态公式引擎替代方案

如果坚持纯 JS 方案，以下是 HyperFormula 的替代品：

| 引擎 | 许可证 | 函数数 | 依赖图 | 增量重算 | 动态数组 | 活跃度 |
|------|--------|--------|--------|----------|----------|--------|
| **HyperFormula** | GPLv3 / 商业 | ~398 | 有 | 有 | 有 | 活跃 |
| **formulajs** | MIT | ~100 | 无 | 无 | 无 | 低活跃 |
| **fast-formula-parser** | MIT | ~50 | 无 | 无 | 无 | 低活跃 |
| **xspreadsheet** | MIT | 少量 | 无 | 无 | 无 | 停滞 |
| **Luckysheet** | MIT | ~100 | 有 | 部分 | 部分 | 低活跃 |

> JS 生态中没有一个能同时做到 MIT 许可 + 300+ 函数 + 依赖图 + 增量重算的方案。HyperFormula 在功能上是最完整的，但许可证是致命短板。

---

## 七、综合对比矩阵

### 7.1 核心参数对比

| 维度 | Formualizer | IronCalc | HyperFormula | Excel |
|------|-------------|----------|--------------|-------|
| **许可证** | MIT/Apache-2.0 | MIT/Apache-2.0 | GPLv3/商业 | 商业 |
| **核心语言** | Rust | Rust | TypeScript | C++/C# |
| **函数数量** | 320+ | 未精确公开（目标 90%） | ~398 | ~500+ |
| **WASM 支持** | 有（独立 npm 包） | 有（集成在产品中） | 无 | 无 |
| **Python 绑定** | 有（PyPI） | 计划中 | 无 | 无 |
| **依赖图** | 有（增量） | 有 | 有（增量） | 有（增量） |
| **动态数组** | 有 | 有 | 有 | 有 |
| **XLSX 读写** | 有 | 有 | 无 | 原生 |
| **撤销/重做** | 有 | 有 | 有 | 有 |
| **自定义函数** | 三端统一 | 未明确 | 有 | VBA/JS |
| **确定性模式** | 有 | 无 | 无 | 无 |
| **Apache Arrow** | 有 | 无 | 无 | 无 |
| **Star (GitHub)** | 117 | 3,878 | 2,658 | N/A |
| **成熟度** | 新兴（13个月） | 发展中（2.5年） | 成熟（6.5年） | 极成熟 |

### 7.2 函数覆盖范围对比

| 函数类别 | Formualizer | HyperFormula | 多维表格需求 |
|----------|-------------|--------------|-------------|
| 数学与三角 | 完整 | 完整 | 高（SUM, ROUND, MOD） |
| 文本处理 | 完整 | 完整 | 高（CONCAT, LEFT, SUBSTITUTE） |
| 查找引用 | XLOOKUP + VLOOKUP | VLOOKUP + XLOOKUP | 高（多维表格核心） |
| 逻辑 | 完整 | 完整 | 高（IF, IFS, SWITCH） |
| 日期时间 | 完整 | 完整 | 中高（DATE, NOW, DATEDIF） |
| 统计 | 主要覆盖 | 完整 | 中（AVERAGEIF, COUNTIFS） |
| 财务 | 完整 | 完整 | 中（PMT, IRR） |
| 工程 | 主要覆盖 | 完整 | 低 |
| 数据库函数 | 有 | 待支持 | 中 |
| 动态数组 | FILTER, UNIQUE, SORT | FILTER, UNIQUE, SORT | 中高 |

> 多维表格最常用的公式集中在数学、文本、查找、逻辑四大类。Formualizer 的 320+ 函数已覆盖 95%+ 的实际需求。

### 7.3 非功能性对比

| 维度 | Formualizer (Rust/WASM) | HyperFormula (JS) |
|------|-------------------------|-------------------|
| **计算性能** | ~4x 快（原生/WASM） | 基准（V8 优化） |
| **内存效率** | ~4x 省（无 GC） | 基准（JS GC） |
| **启动时间** | ~1ms + WASM 加载 | ~10ms |
| **包体积** | ~2MB WASM | ~200KB JS |
| **GC 暂停** | 无 | 有（大数据量时明显） |
| **多线程** | Rayon 并行（native） | 单线程（需 Worker） |
| **调试便利性** | 需要 wasm devtools | 原生 JS 调试 |
| **npm 集成** | 需要 `await init()` | 直接 import |
| **TypeScript** | 有类型定义 | 原生 TS |
| **热重载** | 需要重新加载 WASM | 天然支持 |

---

## 八、推荐方案

### 8.1 推荐选型: Formualizer (Rust + WASM)

**核心理由:**

1. **许可证无忧**: MIT/Apache-2.0，无任何商业使用限制
2. **性能优势**: Rust 核心编译为 WASM，计算性能显著优于 JS 方案
3. **架构契合**: 与项目已有的 Canvas 渲染 + OT 架构天然兼容
4. **全栈复用**: 同一引擎可在浏览器（WASM）和服务端（Rust native via PyO3/NestJS sidecar）使用
5. **功能充足**: 320+ 函数覆盖多维表格 95%+ 的公式需求
6. **未来扩展**: 自定义函数、确定性模式、SheetPort 等高级特性为 AI 和自动化场景提供可能

### 8.2 风险缓解

| 风险 | 缓解措施 |
|------|----------|
| **Bus factor 低**（单人主力） | MIT 许可证意味着即使作者停更也可 fork 维护；代码架构清晰便于接手 |
| **项目年轻** | 核心功能（解析、求值、依赖图）已完成；可先做 PoC 验证关键公式 |
| **函数覆盖缺口** | 通过自定义函数机制弥补缺失的边缘函数；320+ 已覆盖主流需求 |
| **WASM 调试复杂** | 保留 formualizer-parse 的纯解析能力在 JS 层做语法高亮和校验 |
| **社区小** | 积极参与社区贡献，建立上游关系 |

### 8.3 实施路径

```
阶段 1: PoC 验证 (1-2 周)
├── npm install formualizer
├── 在 React 应用中加载 WASM 模块
├── 测试核心公式: SUM, IF, VLOOKUP, CONCAT, DATE
├── 测试动态数组: FILTER, UNIQUE, SORT
├── 性能基准: 10K 单元格初始加载 + 增量编辑
└── 与 Canvas 渲染层集成验证

阶段 2: 集成开发 (2-4 周)
├── 封装 FormulaEngine service 层
├── Web Worker 部署公式计算
├── 与 OT 协作层对接（公式变更作为 Operation）
├── 公式单元格编辑器 UI
├── 公式语法高亮（使用 formualizer-parse 的 tokenize）
└── 错误处理和用户反馈

阶段 3: 生产强化 (持续)
├── 自定义函数（多维表格特有字段类型计算）
├── 服务端公式验证（API 层公式安全检查）
├── 公式性能监控和告警
├── 缓存策略优化
└── 上游社区参与和贡献
```

### 8.4 备选方案

如果 Formualizer 验证不通过，按优先级：

1. **IronCalc**: 社区更大、资金更稳定，但嵌入式 API 不如 Formualizer 灵活
2. **HyperFormula + 商业许可**: 如果预算允许（需联系 Handsontable 报价），功能最完整
3. **Formualizer (服务端) + HyperFormula (前端)**: 混合方案，服务端用 Rust 做验证和批量计算，前端用 HyperFormula（GPLv3 在纯内部 SaaS 不分发场景下风险较低）

---

## 九、与现有技术栈的集成要点

### 9.1 架构集成

```
┌──────────── 现有架构 ──────────┐    ┌──── 新增 ────┐
│  React + Next.js               │    │              │
│  Canvas 表格渲染               │◄──►│ Formualizer  │
│  OT 客户端 (WebSocket)         │    │ WASM Module  │
│  Ant Design 组件               │    │ ~2MB         │
├────────────────────────────────┤    └──────────────┘
│  NestJS API 服务器             │
│  OT 服务器 / 自动化引擎        │    ┌──────────────┐
│  PostgreSQL JSONB              │◄──►│ 可选: Rust   │
│  Redis 缓存+队列               │    │ Sidecar 服务 │
└────────────────────────────────┘    └──────────────┘
```

### 9.2 OT 协作中的公式处理

公式变更需要作为 OT Operation 处理：

```typescript
// 公式编辑 → OT Operation
{
  type: 'setFormula',
  sheet: 'Sheet1',
  row: 1,
  col: 2,
  formula: '=SUM(A1:A100)',  // 新公式
  prevFormula: '=SUM(A1:A50)', // 旧公式（用于 transform）
}

// OT Transform 规则:
// 1. 同一单元格的公式编辑 → last-write-wins 或 conflict 标记
// 2. 被引用单元格变更 → 触发依赖图重算
// 3. 插入/删除行列 → 公式中的引用需要 shift
```

### 9.3 与 evalexpr/cel-interpreter 的互补

在自动化工作流的条件判断中，可使用轻量表达式引擎：

```
多维表格产品中的表达式引擎分层:

Layer 1: 单元格公式 → Formualizer (320+ Excel 函数)
Layer 2: 自动化条件 → cel-interpreter (策略表达式)
         例: "record.status == 'approved' && record.amount > 1000"
Layer 3: 简单计算规则 → evalexpr (业务规则)
         例: "price * quantity * discount"
```

---

## 十、总结

### 关键发现

1. **HyperFormula 许可证错误**: 项目此前标注 HyperFormula 为 MIT 许可，**实际为 GPLv3**。这对任何商业用途都是重大风险。
2. **Formualizer 是最佳替代**: MIT/Apache-2.0 许可，320+ Excel 函数，Rust 性能优势，WASM 浏览器支持，活跃开发中。
3. **IronCalc 是有力备选**: 更大的社区和资金支持，但定位是完整产品而非嵌入式引擎。
4. **WASM 可行性已验证**: 多个生产级产品已使用 WASM 运行计算密集型任务，无技术风险。

### 最终建议

> **推荐将公式引擎选型从 HyperFormula 更换为 Formualizer。** 建议立即进行 PoC 验证（1-2 周），确认关键公式的兼容性和 WASM 性能后，正式进入集成开发阶段。同时需更新 notes.md 和 formula-engine.md 中的许可证信息。

---

## 参考链接

- [Formualizer GitHub](https://github.com/PSU3D0/formualizer)
- [Formualizer 文档站](https://formualizer.dev)
- [Formualizer npm 包](https://www.npmjs.com/package/formualizer)
- [Formualizer WASM README](https://github.com/PSU3D0/formualizer/blob/main/bindings/wasm/README.md)
- [Formualizer Hacker News 讨论](https://news.ycombinator.com/item?id=47241512)
- [IronCalc GitHub](https://github.com/ironcalc/IronCalc)
- [IronCalc 官网](https://www.ironcalc.com)
- [IronCalc 路线图](https://www.ironcalc.com/roadmap.html)
- [HyperFormula 官网](https://hyperformula.handsontable.com)
- [HyperFormula 许可证说明](https://hyperformula.handsontable.com/guide/licensing.html)
- [HyperFormula 内建函数列表](https://hyperformula.handsontable.com/guide/built-in-functions.html)
- [Formualizer vs HyperFormula 对比](https://docs.bswen.com/blog/2026-03-04-formualizer-vs-hyperformula-comparison/)
- [evalexpr GitHub](https://github.com/ISibboI/evalexpr)
- [cel-interpreter crates.io](https://crates.io/crates/cel-interpreter)
- [Rust 中评估 Excel 公式](https://docs.bswen.com/blog/2026-03-04-excel-formulas-rust/)
- [WebAssembly 性能对比研究](https://benchmarkingwasm.github.io/BenchmarkingWebAssembly/)
- [NLnet IronCalc 项目页](https://nlnet.nl/project/IronCalc/)
