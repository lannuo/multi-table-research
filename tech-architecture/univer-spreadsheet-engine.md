# Univer — 前端表格引擎

## 概述
- **GitHub**: https://github.com/dream-num/univer
- **定位**: AI原生电子表格全栈框架
- **语言**: TypeScript (主要) + Go (univer-go)
- **许可证**: 开源

## 技术架构

### 核心特性
- **公式引擎**: 闪电般快速，支持在Web Workers或服务端运行
- **插件化架构**: 高度模块化，可扩展
- **同构渲染**: 同时支持浏览器和Node.js
- **AI集成**: MCP服务器(univer-mcp)支持AI驱动操作
- **前端集成**: Next.js, React兼容

### 架构组成
| 模块 | 说明 |
|---|---|
| Univer Sheets | 电子表格组件，支持浏览器+Node.js |
| Formula Engine | 独立公式引擎，可脱离UI运行 |
| univer-go | Go语言伴生产品 |
| univer-mcp | MCP协议服务器，AI集成 |

## 适用场景
- 作为多维表格的前端渲染引擎
- 公式引擎可以独立使用
- AI原生设计，便于后续AI功能集成

## 参考链接
- [Univer GitHub](https://github.com/dream-num/univer)
- [10个最佳电子表格组件 2025](https://blog.univer.ai/posts/10-best-spreadsheet-components-for-developers-in-2025/)
- [Univer官方文档](https://docs.univer.ai/guides/sheets)
- [Next.js集成示例](https://github.com/awesome-univer/sheets-nextjs-demo)
