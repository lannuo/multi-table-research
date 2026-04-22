# 导入/导出方案设计

## 需求分析
多维表格需要支持:
- 导入: Excel(.xlsx), CSV, JSON, 其他多维表格
- 导出: Excel, CSV, JSON, PDF(视图)
- 大文件处理: 百万行级别的导入导出

## 导入方案

### Excel导入
- **库**: `xlsx` (SheetJS) / `exceljs` (Node.js)
- **流程**: 上传文件 → 解析 → 字段类型推断 → 映射到表结构 → 批量写入
- **大文件**: 流式解析(Streaming), 逐行处理, 避免全量加载到内存

### CSV导入
- **库**: `papaparse` (前端) / `csv-parser` (Node.js)
- **PostgreSQL原生**: `COPY FROM` 命令性能最优
- **大文件**: 流式处理 + 批量INSERT

### 导入流程设计
```
1. 上传文件 → 临时存储
2. 预览解析 → 展示前100行, 推断字段类型
3. 字段映射 → 用户确认/调整列映射关系
4. 数据校验 → 检查类型匹配、必填字段、重复等
5. 批量写入 → 分批INSERT (每批1000行)
6. 进度反馈 → WebSocket推送导入进度
7. 结果报告 → 成功/失败/跳过行数
```

### 大文件导入优化
| 策略 | 说明 |
|------|------|
| 流式解析 | 不全量加载到内存 |
| 批量INSERT | 每1000行一个事务 |
| COPY命令 | PostgreSQL原生批量导入 |
| 异步队列 | 大文件导入放入后台任务队列 |
| 进度反馈 | WebSocket实时推送进度 |

## 导出方案

### Excel导出
- **库**: `exceljs` — 支持流式生成，适合大数据量
- **考虑**: 保持视图的排序/筛选/分组状态

### CSV导出
- 流式生成，逐行输出
- 支持视图的筛选/排序条件

### JSON导出
- 导出Snapshot结构(APITable格式)
- 用于表间复制/备份

## 参考链接
- [大CSV文件处理最佳实践](https://dromo.io/blog/best-practices-handling-large-csv-files)
- [大CSV导入 - Stack Overflow](https://stackoverflow.com/questions/4166506/best-practices-for-importing-large-csv-files)
- [大Excel文件导入 - Mendix](https://docs.mendix.com/refguide/import-a-large-excel-file/)
- [大批量数据导入 - Reddit](https://www.reddit.com/r/AskProgramming/comments/1mii97s/suggestion_for_a_better_way_to_import_large/)
