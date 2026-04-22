# AI能力集成方案

## 为什么需要AI
飞书和Notion都在2025年大力集成AI能力:
- **飞书**: AI工作流搭建、智能字段提取、DeepSeek集成
- **Notion**: AI Agent、跨应用搜索、智能写作
- **Airtable**: AI驱动的数据分析、报告生成、字段提取

AI是多维表格从"工具"升级为"智能平台"的关键。

## AI能力矩阵

### 第一层: 智能数据处理
| 功能 | 说明 | 实现复杂度 |
|------|------|-----------|
| **AI字段提取** | 从非结构化文本中提取结构化字段 | 中 |
| **智能分类** | 自动对记录分类/打标签 | 低 |
| **数据清洗** | 自动识别和修复数据质量问题 | 中 |
| **智能补全** | 根据上下文自动补全单元格 | 低 |

### 第二层: 智能分析
| 功能 | 说明 | 实现复杂度 |
|------|------|-----------|
| **自然语言查询** | "找出本月销售额最高的前10个客户" | 高 |
| **自动摘要** | 自动生成数据摘要和洞察 | 中 |
| **异常检测** | 自动发现数据异常和趋势 | 高 |
| **智能仪表盘** | 根据数据自动推荐可视化方案 | 高 |

### 第三层: AI工作流
| 功能 | 说明 | 实现复杂度 |
|------|------|-----------|
| **AI自动化动作** | 工作流中嵌入AI处理步骤 | 中 |
| **AI Agent** | 自主执行复杂任务的AI代理 | 高 |
| **智能推荐** | 推荐下一个操作/字段/视图 | 中 |

## 技术实现方案

### 架构
```
┌──────────── 前端 ────────────┐
│  AI交互组件(对话框/侧边栏)    │
├──────────── API层 ───────────┤
│  AI Service (NestJS)         │
│  ├── Prompt管理              │
│  ├── 上下文构建              │
│  └── 结果解析                │
├──────────── AI引擎 ──────────┤
│  LLM API (OpenAI/Claude/    │
│  本地模型Ollama)             │
├──────────── 数据 ────────────┤
│  PostgreSQL (上下文/历史)     │
│  Vector DB (嵌入/检索)       │
└──────────────────────────────┘
```

### AI字段提取实现
```typescript
// 用户输入一段文本，AI自动提取为结构化字段
async function extractFields(text: string, fieldDefs: FieldDef[]): Promise<Record> {
  const prompt = `从以下文本中提取字段值:
文本: "${text}"
字段定义: ${JSON.stringify(fieldDefs)}
请返回JSON格式的字段值。`;

  const result = await llm.complete(prompt);
  return JSON.parse(result);
}
```

### 自然语言查询实现
```typescript
// 将自然语言转为数据库查询
async function naturalLanguageQuery(question: string, tableSchema: TableSchema): Promise<Query> {
  const prompt = `将以下自然语言问题转为数据库查询:
表结构: ${JSON.stringify(tableSchema)}
问题: "${question}"
返回筛选条件、排序、聚合等JSON格式的查询。`;

  return await llm.complete(prompt);
}
```

## 部署选择
| 方案 | 说明 | 适合场景 |
|------|------|---------|
| **云端API** | OpenAI/Claude API | 快速起步，效果好 |
| **本地模型** | Ollama + 开源模型 | 数据隐私要求高 |
| **混合** | 简单任务本地，复杂任务云端 | 平衡成本和效果 |

## 分阶段引入
1. **初期**: AI字段提取 + 智能分类 (调用云端API)
2. **中期**: 自然语言查询 + 自动摘要
3. **长期**: AI Agent + 智能推荐 + 本地模型部署

## 参考链接
- [Notion AI Workspace](https://www.notion.com/)
- [Airtable AI自动化](https://www.mindstudio.ai/blog/airtable-meets-ai-smarter-automations/)
- [Notion vs Airtable AI对比](https://www.eesel.ai/blog/notion-vs-airtable)
- [Airtable vs Notion AI工作流](https://www.smiansh.com/blogs/airtable-automations-vs-notion-ai-workflows-knowledge-workers/)
