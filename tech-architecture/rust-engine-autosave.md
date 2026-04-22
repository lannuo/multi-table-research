# 飞书多维表格 Rust 引擎 & 自动保存机制

## 飞书多维表格确认使用 Rust

### 确凿证据

#### 1. 字节跳动招聘信息 (猎聘)
> 资深后端开发工程师-飞书多维表格
> **负责多维表格数据库 Rust 迅算引擎的设计、研发、上线**

直接证明了飞书多维表格底层使用了 **Rust 公式/迅算引擎**。

#### 2. 飞书多维表格数据库技术架构 (网易报道)
飞书多维表格数据库整合了多种先进技术:

| 技术组件 | 说明 |
|---------|------|
| **Rust 公式运算引擎** | 高性能公式计算，利用Rust的内存安全和并发优势 |
| **内存表格视图引擎** | 内存级别的表格数据管理 |
| **智能算力调度引擎** | 动态调度计算资源 |
| **MPP 大规模并行处理系统** | 支持大规模数据并行处理 |

#### 3. 2025年性能指标
- 单表支持 **1000万热行**
- 计算速度进入 **毫秒级**
- 仪表盘新增专业BI功能

### 为什么飞书选择 Rust

| Rust优势 | 在多维表格中的应用 |
|---------|-----------------|
| **极致性能** | 接近C/C++，公式计算毫秒级 |
| **内存安全** | 无GC暂停，适合实时计算 |
| **并发能力** | 安全的多线程并行处理 |
| **WASM支持** | 可编译为WebAssembly在浏览器中运行 |
| **与C互操作** | 可集成现有C/C++库 |

### Rust在多维表格中的应用场景
```
1. 公式计算引擎 — 数百万单元格的公式求值
2. 数据排序/筛选 — 大数据量的内存操作
3. 数据序列化 — Arrow IPC / Parquet 读写
4. 协作冲突解决 — OT/CRDT的高性能实现
5. 增量计算 — 只重算变更部分，毫秒级响应
```

## 自动保存机制设计

### Notion的自动保存方案
根据Notion官方博客披露的架构:

```
用户操作 → Operation → Transaction
                        ↓
              立即应用到本地状态 (内存+IndexedDB/SQLite)
                        ↓
              TransactionQueue (异步)
                        ↓
              /saveTransactions API (HTTP)
                        ↓
              服务器持久化 → 返回成功
                        ↓
              通知 MessageStore → 推送给协作者
```

**关键**: 本地先保存，服务端异步持久化

### 自动保存的三层策略

#### 第一层: 内存 (毫秒级)
```
每次操作 → 立即更新内存状态 → UI重渲染
用户体验: 即时响应，无感知延迟
```

#### 第二层: 本地持久化 (秒级)
```
策略: Debounce (防抖) — 用户停止操作2秒后触发
存储: IndexedDB (浏览器) / SQLite (原生App)
目的: 防止浏览器崩溃丢失数据
```

```typescript
// Debounce自动保存
const debouncedSave = debounce((operations) => {
  localDB.saveOperations(operations);
}, 2000); // 2秒无操作后保存

editor.on('change', (op) => {
  applyToMemory(op);        // 立即
  debouncedSave(op);        // 延迟本地保存
  sendToServer(op);         // 异步服务端保存
});
```

#### 第三层: 服务端持久化 (异步)
```
策略: TransactionQueue 异步发送
重试: 失败自动重试，保存在IndexedDB中直到成功
冲突: OT/CRDT在服务端解决
```

### 自动保存 vs 手动保存

| 维度 | 自动保存 | 手动保存 |
|------|---------|---------|
| 用户体验 | 无感知，不丢数据 | 需要记得保存 |
| 冲突频率 | 频繁小冲突 | 少量大冲突 |
| 实现复杂度 | 高(TransactionQueue) | 低 |
| Notion/飞书 | 都是自动保存 | - |

### 多维表格特有的自动保存挑战
1. **批量操作**: 粘贴1000行数据 → 需要分批保存
2. **公式重算**: 修改一个单元格可能触发级联公式重算
3. **视图更新**: 数据变更后多个视图都需要更新
4. **协作冲突**: 多人同时编辑同一单元格

### 推荐实现
```
操作流: 用户操作 → 内存(立即) → 本地DB(debounce 2s) → 服务端(async)
事务: 每次变更 = 一个Transaction = 多个Operation
队列: TransactionQueue 保证顺序和重试
版本: 每个Transaction递增revision号
快照: 每隔N个revision生成Snapshot用于恢复
```

## 对我们项目的启示

### Rust引擎的启示
1. **公式引擎用Rust重写**是值得考虑的方向
2. Rust编译为WASM可在浏览器中运行
3. Univer的公式引擎也支持Web Worker/服务端，Rust可以进一步优化
4. 初期用HyperFormula(JS)验证功能，后期可用Rust优化性能

### 自动保存的启示
1. 三层保存: 内存→本地→服务端
2. 本地保存用Debounce，服务端用TransactionQueue
3. 自动保存是标配，不是可选功能

## 参考链接
- [飞书多维表格Rust招聘 - 猎聘](https://www.liepin.com/job/1972493393.shtml)
- [飞书效率工具技术架构 - 网易](https://www.163.com/dy/article/JB94HBR70511FQO9.html)
- [飞书多维表格2025升级 - 新浪](https://finance.sina.com.cn/tech/roll/2025-07-11/doc-inffawip9299107.shtml)
- [Debounce vs Throttle自动保存](https://dev.to/kartikbudhraja/debouncing-and-throttling-choosing-the-right-strategy-for-your-web-projects-5cjh)
- [React自动保存实现](https://www.reddit.com/r/react/comments/1gusr8k/how_i_can_implement_auto_save_in_my_application/)
- [Notion Block模型详解](../tech-architecture/notion-block-model-detail.md) (本地文件)
