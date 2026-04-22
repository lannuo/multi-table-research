# Notion Block 模型详解（官方博客翻译/整理）

> 来源: https://www.notion.com/blog/data-model-behind-notion
> 作者: Jake Titon-Landis (Notion工程团队)

## 核心理念
- Notion的信息最小原子单位是 **Block（块）**
- 与传统文档编辑器以"页面"为最小单位不同，Notion以Block为原子单位
- 目标：让信息独立存在，不受容器约束，用户在粒度层面拥有控制权

## Block 的属性

每个Block包含:

### 1. ID
- 唯一标识，使用 UUID v4
- 页面Block的ID可在浏览器URL末尾看到

### 2. Properties（属性）
- 包含自定义属性的数据结构
- 最常见的是 `title`（存储文本内容）
- 数据库中的页面Block有用户自定义属性

### 3. Type（类型）
- 决定Block如何显示
- 决定属性如何被解释
- 支持多种类型（段落、列表、页面等）
- **改变类型不改变属性和内容**，只改变渲染方式

### 4. Content（内容）
- Block ID的有序数组（向下指针）
- 引用嵌套的子Block
- 形成层级结构（Render Tree）

### 5. Parent（父级）
- 父Block的ID（向上指针）
- **仅用于权限系统**，不用于内容渲染

## 关键架构决策

### 属性存储与类型解耦
- 属性存储与Block类型分离
- 允许高效的类型转换（如待办→标题→高亮→待办，checked状态始终保留）
- 对协作至关重要——最大限度保留用户意图

### 渲染树（Render Tree）
- Block通过Content属性形成层级关系
- 不同类型Block以不同方式渲染子Block:
  - **列表Block**: 缩进显示
  - **开关Block**: 展开时显示，收起时只显示标题
  - **页面Block**: 在新页面中显示

### 缩进是结构性的
- Notion中缩进不是样式，而是**结构性操作**
- 缩进 = 操作Block之间的关系
- 按缩进键 = 将Block移到前一个兄弟Block的Content中

### 权限系统
- 不能用Content数组做权限（因为Block可被多处引用，存在歧义）
- 使用Parent指针（向上指针）实现权限继承
- 从Block向上追溯到Workspace根节点进行权限检查

## 数据流：Block的生命周期

### 1. 创建Block（客户端）
- 用户操作 → 生成操作(Operation) → 批量为事务(Transaction)
- 客户端立即应用操作到本地状态
- 原生App使用 RecordCache (SQLite/IndexedDB LRU缓存)
- 事务存入 TransactionQueue (IndexedDB/SQLite)

### 2. 保存到服务器
- TransactionQueue → `/saveTransactions` API
- 服务器流程:
  1. 加载事务涉及的所有Block和父Block（"before"快照）
  2. 复制并应用操作生成"after"快照
  3. 验证权限和数据一致性
  4. 提交到数据库
  5. 返回HTTP成功响应
  6. 后台调度：版本历史快照、文本索引（Quick Find）、通知MessageStore

### 3. 实时更新
- 每个客户端与 MessageStore 保持 WebSocket 长连接
- 客户端订阅（subscribe）其渲染的所有记录的变更
- 变更流程: API → 通知MessageStore → 找到订阅的客户端 → 推送版本更新
- 客户端收到更新 → 比较版本 → `syncRecordValues` API拉取新数据 → 更新本地缓存 → 重新渲染

### 4. 读取Block
- 优先从本地加载（内存/RecordCache）
- 缺失数据 → `loadPageChunk` API
- loadPageChunk从起始Block沿Content树向下递归获取所有Block
- 使用多层缓存
- 数据加载后使用 React 渲染

## 对我们项目的启示
1. **Block模型是核心**：一切皆Block，统一数据模型
2. **双指针系统**：Content（向下）+ Parent（向上），分别用于渲染和权限
3. **属性与类型解耦**：灵活的类型转换
4. **事务系统**：操作批量提交，保证一致性
5. **WebSocket + 版本号**：实时协作的基础
6. **本地优先**：先应用本地状态，再异步持久化
