# Notion 技术架构

## 核心数据模型: Block模型
- Notion中**一切皆Block**（文字、页面、数据库行都是Block）
- 每个Block有: `type`, `content`, `parent` 引用
- 形成父子层级结构（树/图结构）
- Block之间的引用关系构成**有向图(DAG)**

## 架构关键点

### 1. 原子化图状数据模型
- Notion官方博客描述: "We wanted an atomic, graph-like data model"
- 用户可以自由移动、组织、分享信息
- 每个元素都是独立的、可引用的原子单元

### 2. Database as Block
- 数据库本身也是一个Block
- 数据库的每一行也是一个Block，可以包含任意内容
- 这意味着每行数据不仅可以有字段值，还可以是一个完整的wiki/notes页面

### 3. Frame-based 方案
- 应用特定的功能被打包成可复用的"frames"
- 来自Hacker News讨论的技术细节

### 4. 分片策略
- 按workspace ID分片 (Workspace-based Sharding)
- 数据量3年增长10倍，每6-12个月翻倍
- 对关键表（如blocks相关表）按workspace隔离

## 数据规模与扩展
- 数据3年增长10倍
- 构建了数据湖来支撑分析需求
- 详细内容参考: [Building and Scaling Notion's Data Lake](https://www.notion.com/blog/building-and-scaling-notions-data-lake)

## 参考链接
- [The Data Model Behind Notion's Flexibility - Notion官方博客](https://www.notion.com/blog/data-model-behind-notion)
- [Design Notion - 系统设计](https://www.techinterview.org/post/3233474362/system-design-design-notion-collaborative-workspace-blocks-database-real-time-editing-permissions-api-integrations/)
- [Notion System Design - Educative.io](https://www.educative.io/blog/notion-system-design)
- [Notion数据模型 - Reddit讨论](https://www.reddit.com/r/Notion/comments/j119h7/technical_tldr_on_notions_data_model/)
- [Hacker News讨论](https://news.ycombinator.com/item?id=27200177)
- [Notion数据库扩展 - Medium](https://medium.com/@nidhey60/how-notion-prepared-their-database-for-millions-of-users-dc198079e74c)
- [Notion Data Lake](https://www.notion.com/blog/building-and-scaling-notions-data-lake)
- [YouTube: Behind the Scenes](https://www.youtube.com/watch?v=9fUjHYL-l2w)
