# 实时协作技术方案: CRDT vs OT

## 核心方案对比

### OT (Operational Transform / 操作转换)
- **代表**: ShareDB (2013), Google Docs
- **原理**: 客户端发送操作，服务端做转换后广播
- **优点**: 成熟稳定，Google Docs等大规模验证
- **缺点**: 需要中心化服务器，离线支持弱

### CRDT (Conflict-free Replicated Data Types / 无冲突复制数据类型)
- **代表**: Yjs (2015), Automerge (2017), Loro
- **原理**: 数据结构本身保证最终一致性，无需中心协调
- **优点**: 去中心化，天然支持离线，P2P友好
- **缺点**: 数据开销较大，后端实现语言受限(主要Node.js)

## 主要CRDT库对比

| 库 | 年份 | 类型 | 核心特点 |
|---|---|---|---|
| **Yjs** | 2015 | CRDT | 高性能，共享类型(YText, YMap, YArray, YXml) |
| **Automerge** | 2017 | CRDT | JSON数据模型，local-first，多语言(JS, Swift) |
| **Loro** | 较新 | CRDT | 时间旅行，手动合并 |
| **ShareDB** | 2013 | OT | JSON文档模型，成熟稳定 |

## 适用于多维表格的选择
- **推荐**: Yjs — 性能最优，共享类型丰富(YMap/YArray适合表格)
- Yjs的YMap适合表示行数据，YArray适合表示列和排序
- AI Agent可以作为CRDT peer参与协作（参考Electric SQL方案）

## 参考链接
- [Yjs GitHub](https://github.com/yjs/yjs)
- [Yjs vs Loro对比](https://discuss.yjs.dev/t/yjs-vs-loro-new-crdt-lib/2567)
- [AI Agents as CRDT Peers](https://electric-sql.com/blog/2026/04/08/ai-agents-as-crdt-peers-with-yjs)
- [Automerge Swift](https://forums.swift.org/t/introducing-automerge-enable-collaborative-asynchronous-syncing-for-your-data-structures/67985)
- [Yjs + Next.js协作教程](https://medium.com/@connect.hashblock/from-zero-to-real-time-building-a-live-collaboration-tool-with-yjs-and-next-js-e82eadccd828)
- [实时协作系统设计(YouTube)](https://www.youtube.com/watch?v=EX5uZV3Tzss)
