# 前端组件库与设计系统选型

## 核心需求
多维表格的UI组件需求:
- 表格/网格(高频使用，性能关键)
- 表单(数据录入、字段配置)
- 对话框/抽屉(编辑、设置)
- 拖拽(列排序、看板拖拽)
- 图表/仪表盘(数据可视化)
- 丰富的字段类型编辑器

## 主流方案对比

### Ant Design (推荐)
| 维度 | 评价 |
|------|------|
| 组件数量 | **200+**，最丰富 |
| 企业级组件 | 表格、表单、数据录入齐全 |
| 定制性 | Token系统 + Less变量 |
| 中文生态 | 最好(支付宝团队出品) |
| 文档质量 | 优秀，中文文档完善 |
| 学习曲线 | 中等 |
| 适合场景 | **企业级管理后台、数据密集型应用** |

### ShadCN/ui
| 维度 | 评价 |
|------|------|
| 组件数量 | 50+ (快速增长中) |
| 核心优势 | **完全拥有代码**，非npm依赖 |
| 样式方案 | Tailwind CSS |
| 底层 | 基于Radix UI原语 |
| 定制性 | 极高 |
| 适合场景 | 需要独特视觉风格的产品 |

### Radix UI
| 维度 | 评价 |
|------|------|
| 定位 | **无头(Headless)组件原语** |
| 组件数量 | 30+ 基础原语 |
| 样式 | 无(需自己写) |
| 可访问性 | 最好(WAI-ARIA标准) |
| 适合场景 | 从零构建设计系统 |

### MUI (Material UI)
| 维度 | 评价 |
|------|------|
| 组件数量 | 丰富 |
| 设计风格 | Material Design |
| 数据网格 | MUI X DataGrid(最优秀的表格组件) |
| 适合场景 | Material风格、需要高级DataGrid |

## 推荐策略

### 方案A: Ant Design (推荐)
- 组件最多，表格/表单开箱即用
- 中文生态最好
- 适合快速开发企业级应用
- APITable也使用类似方案

### 方案B: ShadCN + 自研表格
- 视觉风格更自由
- 但需要自研更多组件
- 适合有设计团队的情况

### 表格组件特殊考虑
多维表格的表格渲染是最核心的组件，可能需要**自研Canvas渲染引擎**(参考APITable方案)，不能用普通组件库的Table:
- Ant Design Table: 适合普通数据展示，不适合10万+行
- AG Grid: 商业级表格组件，性能极好但**收费**
- 自研Canvas方案: 性能最好，开发成本最高

**建议**: 初期用Ant Design Table + 虚拟滚动验证功能，后期自研Canvas引擎提升性能。

## 设计系统建设
```
基础层:   颜色/字体/间距/圆角 (Design Tokens)
组件层:   Button/Input/Select/Table/Form/Modal...
模式层:   表格编辑模式/字段编辑器/视图切换器...
页面层:   数据表页面/仪表盘/设置页面...
```

## 参考链接
- [2025 React UI库对比](https://makersden.io/blog/react-ui-libs-2025-comparing-shadcn-radix-mantine-mui-chakra)
- [Ant Design vs ShadCN](https://www.subframe.com/tips/ant-design-vs-shadcn)
- [设计系统对比矩阵](https://dev.to/codefalconx/design-system-comparison-matrix-562e)
- [ShadCN vs Ant Design - Reddit](https://www.reddit.com/r/nextjs/comments/198wpz8/shadcn_vs_antd/)
- [Ant Design vs ShadCN 2025](https://medium.com/@rameshkannanyt0078/ant-design-vs-shadcn-which-should-you-use-in-2025-a36d6f0714e1)
