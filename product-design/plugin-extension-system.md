# 插件/扩展系统设计

## 为什么需要插件系统
多维表格无法内置所有功能，插件系统让用户和开发者可以:
- 添加自定义字段类型
- 创建自定义Widget/仪表盘组件
- 扩展自动化动作
- 集成第三方服务

## 参考方案: APITable Widget系统

### 核心概念
- **Widget**: 独立的UI组件，嵌入到多维表格界面中
- APITable 有 **20+ 官方开源Widget**
- 提供 **Widget SDK** 供开发者创建自定义Widget
- Widget文档: https://developers.aitable.ai/widget/introduction/

### Widget与数据的关系
- Widget通过SDK获取数据表的读/写权限
- Widget可以订阅数据变更事件
- Widget可以是纯展示(图表)或交互(表单、过滤器)

### 自定义字段类型
- GitHub Issue #710 请求自定义字段类型
- 当前添加自定义字段需要深入了解APITable内部模型
- 这是一个复杂但重要的扩展能力

## 插件系统架构设计

### 三层扩展模型
```
┌────────────────────────────────────────────┐
│          插件管理器 (Plugin Manager)         │
│  注册/发现/加载/卸载/权限控制                 │
├────────────────────────────────────────────┤
│          插件SDK (Plugin SDK)               │
│  数据访问API │ UI组件库 │ 事件系统           │
├────────────────────────────────────────────┤
│          插件沙箱 (Plugin Sandbox)           │
│  安全隔离 │ 资源限制 │ 错误隔离              │
└────────────────────────────────────────────┘
```

### 插件类型
| 类型 | 说明 | 示例 |
|------|------|------|
| **Widget** | UI组件，嵌入表格界面 | 图表、统计面板、自定义筛选器 |
| **字段类型** | 自定义列的数据类型 | 条形码、评分、地理位置 |
| **自动化动作** | 自定义工作流动作 | 发送短信、调用内部API |
| **数据源** | 连接外部数据 | MySQL连接器、REST API连接器 |
| **视图** | 自定义视图类型 | 时间线、地图、组织架构图 |

### 插件接口设计
```typescript
interface IPlugin {
  // 插件元信息
  id: string;
  name: string;
  version: string;
  type: 'widget' | 'field' | 'action' | 'datasource' | 'view';

  // 生命周期
  install(context: PluginContext): void;
  activate(): void;
  deactivate(): void;
  uninstall(): void;
}

interface PluginContext {
  // 数据访问
  getTableData(tableId: string): Promise<Record[]>;
  updateRecord(tableId: string, recordId: string, data: any): Promise<void>;

  // 事件订阅
  onDataChange(callback: (event: DataChangeEvent) => void): void;

  // UI渲染(Widget专用)
  render(container: HTMLElement): void;
}
```

### 安全与隔离
| 策略 | 说明 |
|------|------|
| **iframe沙箱** | Widget在独立iframe中运行 |
| **API白名单** | 插件只能调用SDK暴露的API |
| **数据权限** | 插件只能访问用户授权的数据 |
| **资源限制** | CPU/内存/网络请求限制 |
| **代码审核** | 上架前审核(对于公开插件) |

## 分阶段实现

### 阶段1: Widget系统
- 先实现Widget SDK + iframe沙箱
- 支持自定义展示组件

### 阶段2: 自定义字段
- 定义字段类型接口
- 提供字段渲染器SDK

### 阶段3: 自动化插件
- 自定义触发器和动作
- 第三方服务集成

### 阶段4: 插件市场
- 插件发现和安装
- 版本管理和更新

## 参考链接
- [APITable Widget SDK文档](https://developers.aitable.ai/widget/introduction/)
- [APITable Widget文档](https://apitable.getoutline.com/s/82e078fc-1a8d-4616-b69d-fcdbb18ef715/doc/widgets-Y3ehbPIGla)
- [自定义字段类型请求 #710](https://github.com/apitable/apitable/issues/710)
- [可扩展软件设计 - StackOverflow](https://stackoverflow.com/questions/323202/how-to-design-your-software-to-be-extensible)
