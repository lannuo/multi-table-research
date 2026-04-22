# 字段类型系统设计 (含自定义字段类型)

## 核心问题
多维表格不是固定列的表格，用户可以自由创建不同类型的列。更关键的是，系统需要支持**自定义字段类型**——用户或开发者可以定义全新的字段类型，而不仅仅是使用内置的。

## 一、各产品的字段类型对比

### 内置字段类型

| 类型 | Airtable | Notion | APITable | 飞书 | 说明 |
|------|---------|--------|----------|------|------|
| 文本 | ✅ | ✅ | ✅ | ✅ | 单行/多行文本 |
| 数字 | ✅ | ✅ | ✅ | ✅ | 整数/小数/货币/百分比 |
| 单选 | ✅ | ✅ | ✅ | ✅ | 从预设选项中选一个 |
| 多选 | ✅ | ✅ | ✅ | ✅ | 从预设选项中选多个 |
| 日期 | ✅ | ✅ | ✅ | ✅ | 日期+时间 |
| 人员 | ✅ | ✅ | ✅ | ✅ | 从团队成员中选择 |
| 附件 | ✅ | ✅ | ✅ | ✅ | 图片/文件上传 |
| 复选框 | ✅ | ✅ | ✅ | ✅ | 是/否 |
| URL | ✅ | ✅ | ✅ | ✅ | 链接 |
| 邮箱 | ✅ | - | ✅ | - | 邮箱地址 |
| 电话 | ✅ | - | ✅ | - | 电话号码 |
| 自动编号 | ✅ | - | ✅ | ✅ | 自增ID |
| 创建时间 | ✅ | ✅ | ✅ | ✅ | 自动记录创建时间 |
| 修改时间 | ✅ | ✅ | ✅ | ✅ | 自动记录修改时间 |
| 创建人 | ✅ | ✅ | - | ✅ | 自动记录创建人 |
| 修改人 | ✅ | ✅ | - | ✅ | 自动记录修改人 |
| **关联记录** | ✅ | ✅ | ✅(MagicLink) | ✅ | 关联另一张表的记录 |
| **汇总** | ✅ | ✅ | ✅(Rollup) | ✅ | 基于关联的跨表聚合 |
| **公式** | ✅ | ✅ | ✅ | ✅ | 动态计算 |
| **查找引用** | ✅ | - | ✅(Lookup) | ✅ | 引用关联表的字段值 |

### 自定义字段类型支持情况
| 产品 | 支持自定义字段类型？ | 方式 |
|------|---------------------|------|
| **Airtable** | ❌ 不支持 | 封闭系统，只有内置类型 |
| **Notion** | ❌ 不支持 | 封闭系统 |
| **APITable** | ⚠️ 社区请求中 | Issue #710，需要深入了解内部模型 |
| **飞书** | ❌ 不支持 | 封闭系统 |
| **NocoDB** | ✅ 支持 | 基于已有数据库，字段类型由数据库定义 |
| **Baserow** | ✅ 支持 | 插件系统可扩展字段类型 |

**我们的机会**: 支持**自定义字段类型**是一个重要的差异化优势。

---

## 二、字段类型系统架构

### 核心思想: 字段类型 = 数据结构 + 校验 + 渲染 + 编辑器 + 操作符

```
一个字段类型(Field Type)需要定义:

1. 数据结构   → cellValue 在 JSONB 中怎么存
2. 字段配置   → 该类型有哪些可配置项(选项列表、精度、格式等)
3. 数据校验   → 用户输入的值是否合法
4. 显示渲染   → 在表格单元格中如何显示
5. 编辑控件   → 用户如何输入/修改值
6. 筛选操作符 → 该类型支持哪些筛选操作
7. 排序规则   → 该类型如何排序
8. 聚合函数   → 该类型支持哪些聚合(SUM/AVG/COUNT等)
```

### 字段类型注册表 (Registry Pattern)

```typescript
interface IFieldType {
  // === 元信息 ===
  id: string;                           // 'text', 'number', 'singleSelect', 'myCustomType'
  name: string;                         // 显示名称
  icon: string;                         // 图标
  category: 'basic' | 'advanced' | 'computed' | 'custom';

  // === 数据结构 ===
  // 定义该字段的 cellValue 在 JSONB 中的存储格式
  cellValueSchema: JSONSchema;           // JSON Schema 描述

  // === 字段配置 ===
  // 创建字段时可配置的参数
  configSchema: JSONSchema;              // 字段配置的 JSON Schema
  defaultConfig: Record<string, any>;    // 默认配置

  // === 数据校验 ===
  validate(value: unknown, config: FieldConfig): ValidationResult;

  // === 序列化 ===
  serialize(value: CellValue): JsonValue;  // 内存 → JSONB
  deserialize(raw: JsonValue): CellValue;  // JSONB → 内存
  stringify(value: CellValue): string;     // 转为显示文本(用于搜索)

  // === UI渲染 ===
  CellRenderer: React.ComponentType<CellRendererProps>;  // 单元格显示
  EditorComponent: React.ComponentType<EditorProps>;      // 编辑控件
  ConfigPanel: React.ComponentType<ConfigPanelProps>;     // 字段配置面板

  // === 筛选 ===
  supportedOperators: Operator[];        // 支持的筛选操作符
  toFilterSQL(operator: Operator, value: any, fieldId: string): { sql: string; params: any[] };

  // === 排序 ===
  compare(a: CellValue, b: CellValue, config: FieldConfig): number;

  // === 聚合 ===
  supportedAggregations: AggregationType[]; // 'sum', 'avg', 'count', 'min', 'max'
  aggregate(values: CellValue[], type: AggregationType, config: FieldConfig): any;
}
```

### 注册表实现

```typescript
class FieldTypeRegistry {
  private types = new Map<string, IFieldType>();

  // 注册字段类型
  register(type: IFieldType): void {
    this.types.set(type.id, type);
  }

  // 获取字段类型
  get(typeId: string): IFieldType {
    const type = this.types.get(typeId);
    if (!type) throw new Error(`Unknown field type: ${typeId}`);
    return type;
  }

  // 获取所有可用类型
  getAll(): IFieldType[] {
    return Array.from(this.types.values());
  }

  // 按分类获取
  getByCategory(category: string): IFieldType[] {
    return this.getAll().filter(t => t.category === category);
  }
}

// 全局单例
export const fieldTypes = new FieldTypeRegistry();
```

---

## 三、内置字段类型的 cellValue 数据结构

参考 APITable 的设计，每种字段类型有独立的 cellValue 格式:

```typescript
// === 基础字段 ===

// 文本
{ "fld_text": [{ "type": 1, "text": "Hello World" }] }

// 数字 (精度由字段配置决定)
{ "fld_number": [{ "type": 1, "text": "42.5" }] }

// 单选 (值为选项ID)
{ "fld_singleSelect": ["optRed123"] }

// 多选 (值为选项ID数组)
{ "fld_multiSelect": ["optRed123", "optBlue456"] }

// 日期 (时间戳，毫秒)
{ "fld_date": 1655876993000 }

// 人员 (用户ID数组)
{ "fld_person": ["usrAbc123", "usrDef456"] }

// 复选框 (布尔)
{ "fld_checkbox": true }

// URL
{ "fld_url": { "text": "https://example.com", "title": "Example" } }

// 附件
{ "fld_attachment": [
  { "id": "att123", "name": "photo.jpg", "size": 102400, "mimeType": "image/jpeg", "url": "..." }
]}

// === 高级字段 ===

// 关联记录 (记录ID数组)
{ "fld_link": ["recAbc123", "recDef456"] }

// 公式 (计算结果，格式与结果类型对应)
{ "fld_formula": [{ "type": 1, "text": "100" }] }

// 汇总 (聚合结果)
{ "fld_rollup": [{ "type": 1, "text": "5" }] }

// 查找引用 (引用的值)
{ "fld_lookup": ["optRed123"] }

// === 自动字段 (系统维护) ===

// 自动编号
{ "fld_autoNumber": 42 }

// 创建时间/修改时间 (时间戳)
{ "fld_createdAt": 1655876993000 }
```

---

## 四、字段配置 (Field Config)

每种字段类型可以有自己的配置项，存储在 fields 表的 config JSONB 中:

```typescript
// 单选字段配置
interface SingleSelectConfig {
  options: Array<{
    id: string;           // optRed123
    name: string;         // "紧急"
    color: string;        // "#FF0000"
  }>;
}

// 数字字段配置
interface NumberConfig {
  precision: number;      // 小数位数: 0=整数, 2=两位小数
  format: 'number' | 'currency' | 'percent';
  currency?: string;      // 'CNY', 'USD'
  separator: boolean;     // 是否显示千分位
}

// 日期字段配置
interface DateConfig {
  format: string;         // 'YYYY-MM-DD', 'YYYY/MM/DD HH:mm'
  timeFormat: '12h' | '24h' | 'none';
  autoFill: boolean;      // 新建记录自动填充当前时间
}

// 关联记录配置
interface LinkConfig {
  foreignTableId: string; // 关联的目标表ID
  relationship: 'oneToMany' | 'manyToOne' | 'manyToMany';
  symmetricFieldId?: string; // 双向关联时，目标表中的反向字段ID
}

// 公式配置
interface FormulaConfig {
  expression: string;     // "SUM({fld_amount}) * 1.1"
  resultType: 'number' | 'text' | 'date' | 'boolean';
}
```

---

## 五、自定义字段类型的实现

### 场景举例: 用户想创建一个"评分"字段类型
用户想创建一个星级评分字段(1-5星)，这不是任何内置类型能完美满足的。

### 自定义字段类型的三种实现级别

#### 级别1: 字段配置变体 (最简单)
不创建新类型，而是基于内置类型配置:
```
数字字段 + config: { min: 1, max: 5, format: "rating" }
```
前端根据 config.format === "rating" 渲染星级组件。
**优点**: 无需扩展，复用已有类型
**缺点**: 有限，无法完全自定义

#### 级别2: 插件注册新类型 (推荐)
开发者编写一个字段类型插件，注册到系统中:

```typescript
// 自定义"评分"字段类型插件
const RatingFieldType: IFieldType = {
  id: 'rating',
  name: '评分',
  icon: '⭐',
  category: 'custom',

  // 数据结构: 存一个数字
  cellValueSchema: {
    type: 'number',
    minimum: 1,
    maximum: 5
  },

  // 字段配置: 最大星数可调
  configSchema: {
    type: 'object',
    properties: {
      maxStars: { type: 'number', default: 5, minimum: 3, maximum: 10 }
    }
  },
  defaultConfig: { maxStars: 5 },

  // 校验
  validate(value, config) {
    if (typeof value !== 'number') return { valid: false, errors: ['必须是数字'] };
    if (value < 1 || value > config.maxStars) return { valid: false, errors: [`必须在1-${config.maxStars}之间`] };
    return { valid: true };
  },

  // JSONB存储: 直接存数字
  serialize(value) { return value; },
  deserialize(raw) { return raw; },
  stringify(value) { return `${value}星`; },

  // UI: 星级渲染
  CellRenderer: ({ value, config }) => (
    <StarRating value={value} max={config.maxStars} readOnly />
  ),

  // UI: 星级编辑器
  EditorComponent: ({ value, onChange, config }) => (
    <StarRating value={value} max={config.maxStars} onChange={onChange} />
  ),

  // UI: 字段配置面板
  ConfigPanel: ({ config, onChange }) => (
    <div>
      <label>最大星数</label>
      <input type="number" min={3} max={10}
        value={config.maxStars}
        onChange={e => onChange({ ...config, maxStars: +e.target.value })}
      />
    </div>
  ),

  // 筛选操作符
  supportedOperators: ['equal', 'notEqual', 'greater', 'less', 'isEmpty'],
  toFilterSQL(operator, value, fieldId) {
    // 复用数字类型的SQL生成
    return numberFilterSQL(operator, value, fieldId);
  },

  // 排序: 按数字排序
  compare(a, b) { return (a || 0) - (b || 0); },

  // 聚合: 支持平均值
  supportedAggregations: ['avg', 'min', 'max', 'count'],
  aggregate(values, type) {
    const nums = values.filter(v => v != null) as number[];
    switch (type) {
      case 'avg': return nums.reduce((a, b) => a + b, 0) / nums.length;
      case 'min': return Math.min(...nums);
      case 'max': return Math.max(...nums);
      case 'count': return nums.length;
    }
  }
};

// 注册
fieldTypes.register(RatingFieldType);
```

#### 级别3: 用户完全自定义 (高级)
提供一个可视化编辑器，让非技术用户也能创建新字段类型:
- 选择基础数据类型(数字/文本/选项)
- 自定义UI显示(选择渲染模式: 进度条/星级/标签/色块...)
- 自定义校验规则
- 打包为可复用的字段模板

---

## 六、字段类型的前后端协作

### 创建字段流程
```
1. 用户点击"+"添加列
2. 弹出字段类型选择面板(从 Registry 获取所有类型)
3. 选择类型 → 显示该类型的 ConfigPanel
4. 配置字段参数(如选项列表、精度等)
5. 保存 → 写入 fields 表:
   INSERT INTO fields (id, table_id, name, field_type, config)
   VALUES ('fld123', 'tbl456', '评分', 'rating', '{"maxStars": 5}');
```

### 数据录入流程
```
1. 用户点击单元格
2. 系统根据 field_type 从 Registry 获取对应的 EditorComponent
3. 渲染编辑器(星级选择器)
4. 用户选择值
5. 校验 → 序列化为 cellValue → 存入 record.data
```

### 数据显示流程
```
1. 渲染表格
2. 每个单元格根据 field_type 从 Registry 获取 CellRenderer
3. 渲染显示(星级)
```

### 筛选流程
```
1. 筛选面板列出所有字段
2. 选择字段 → 从 Registry 获取该类型的 supportedOperators
3. 选择操作符 → 渲染对应的值输入控件
4. 应用筛选 → 调用该类型的 toFilterSQL 生成SQL
```

---

## 七、数据库存储设计

```sql
-- 字段定义
CREATE TABLE fields (
    id          UUID PRIMARY KEY,
    table_id    UUID NOT NULL REFERENCES tables(id),
    name        VARCHAR(255) NOT NULL,
    field_type  VARCHAR(50) NOT NULL,  -- 'text', 'number', 'rating', 'myCustomType'
    config      JSONB DEFAULT '{}',    -- 字段配置(选项列表、精度等)
    -- rating: {"maxStars": 5}
    -- singleSelect: {"options": [{"id":"opt1","name":"紧急","color":"#FF0000"}, ...]}
    -- number: {"precision": 2, "format": "currency", "currency": "CNY"}
    -- link: {"foreignTableId": "tbl789", "relationship": "oneToMany"}
    -- formula: {"expression": "SUM({fld_amount})", "resultType": "number"}
    created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- 记录数据
-- data JSONB 的 key 是 fieldId, value 是 cellValue
-- cellValue 的格式由 field_type 决定
CREATE TABLE records (
    id       UUID PRIMARY KEY,
    table_id UUID NOT NULL,
    data     JSONB NOT NULL,
    -- 示例: {"fld_text": [{"type":1,"text":"hello"}], "fld_rating": 4}
    stringify JSONB,
    -- 示例: {"fld_text": "hello", "fld_rating": "4星"}
);
```

---

## 八、字段类型转换

用户可以改变现有字段的类型:
```
文本 → 数字: 尝试解析数字，失败的保留为空
单选 → 文本: 选项名称变为文本
文本 → 单选: 自动创建选项(从现有文本值中提取唯一值)
数字 → 评分: 如果值在范围内则保留
```

每个字段类型需要定义 `canConvertFrom` 和 `canConvertTo`:
```typescript
interface IFieldType {
  // ...其他属性

  // 是否可以从其他类型转换过来
  canConvertFrom(sourceType: string): boolean;

  // 执行转换: 将旧类型的cellValue转为新类型的cellValue
  convertValue(oldValue: CellValue, oldType: string, oldConfig: FieldConfig, newConfig: FieldConfig): CellValue;
}
```

---

## 九、自定义字段类型的插件分发

### 方式1: 代码级插件 (开发者)
```typescript
// my-rating-field.ts
export const RatingField: IFieldType = { ... };

// 在应用中注册
import { RatingField } from './my-rating-field';
fieldTypes.register(RatingField);
```

### 方式2: 声明式定义 (低代码用户)
```json
{
  "id": "progress",
  "name": "进度",
  "baseType": "number",
  "display": {
    "renderer": "progressBar",
    "color": "#4CAF50",
    "max": 100
  },
  "validation": {
    "min": 0,
    "max": 100
  }
}
```
系统根据 baseType 继承基础行为，用 display 覆盖渲染。

### 方式3: 插件市场 (未来)
- 社区开发者提交字段类型插件
- 审核后上架
- 用户一键安装

---

## 参考链接
- [Airtable字段类型概览](https://support.airtable.com/docs/field-type-overview)
- [Airtable字段类型和cellValue API](https://www.airtable.com/developers/web/api/field-model)
- [Airtable自定义字段类型讨论](https://community.airtable.com/development-apis-11/how-to-define-a-custom-field-type-5055)
- [APITable Snapshot文档(24种字段类型)](https://apitable.getoutline.com/s/751b142b-866f-4174-a5f1-a2975f85ad41/doc/0x3-snapshots-3lIAWPoaIx)
- [APITable自定义字段类型请求 #710](https://github.com/apitable/apitable/issues/710)
- [AITable字段文档](https://help.aitable.ai/docs/guide/manual/use-field/)
- [Metabase可视化查询构建器](https://www.metabase.com/docs/latest/questions/query-builder/editor)
