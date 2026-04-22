# 数据筛选系统设计

## 核心问题
用户在UI上点击、选择筛选条件，**不需要写SQL**，系统如何把用户的操作转化为数据查询？

## 筛选的本质: 声明式 Filter DSL → 查询执行

```
用户在UI上配置筛选条件
         ↓
转为声明式的 Filter JSON (DSL)
         ↓
后端解析 Filter JSON → 生成 SQL / 内存过滤
         ↓
返回结果
```

用户只操作UI，**Filter JSON 是中间层**，后端负责把它翻译成实际查询。

---

## 一、筛选数据模型 (Filter DSL)

### 基本结构
```json
{
  "conjunction": "and",
  "filters": [
    {
      "fieldId": "fld_status",
      "operator": "is",
      "value": ["已完成"]
    },
    {
      "fieldId": "fld_amount",
      "operator": "isGreater",
      "value": [1000]
    }
  ]
}
```

### 支持条件组嵌套 (AND/OR混合)
```json
{
  "conjunction": "and",
  "filters": [
    {
      "fieldId": "fld_status",
      "operator": "is",
      "value": ["进行中"]
    }
  ],
  "group": [
    {
      "conjunction": "or",
      "filters": [
        {
          "fieldId": "fld_priority",
          "operator": "is",
          "value": ["紧急"]
        },
        {
          "fieldId": "fld_deadline",
          "operator": "isWithin",
          "value": ["thisWeek"]
        }
      ]
    }
  ]
}
```
含义: 状态=进行中 **AND** (优先级=紧急 **OR** 截止日期=本周)

### 每种字段类型的操作符

| 字段类型 | 支持的操作符 |
|---------|-------------|
| **文本** | is, isNot, contains, doesNotContain, isEmpty, isNotEmpty, startsWith, endsWith |
| **数字** | =, ≠, >, <, >=, <=, isEmpty, isNotEmpty |
| **单选** | is, isNot, isEmpty, isNotEmpty |
| **多选** | hasAnyOf, hasAllOf, hasNoneOf, isEmpty, isNotEmpty |
| **日期** | is, isBefore, isAfter, isOnOrBefore, isOnOrAfter, isEmpty, isNotEmpty, isWithin (today/thisWeek/thisMonth/thisYear/lastNDays) |
| **人员** | is, isNot, isEmpty, isNotEmpty |
| **关联记录** | is, isNot, isEmpty, isNotEmpty |
| **复选框** | isChecked, isNotChecked |
| **公式** | =, ≠, >, <, >=, <=, contains, isEmpty, isNotEmpty |

### 相对日期筛选 (用户常用)
```json
{
  "fieldId": "fld_createdAt",
  "operator": "isWithin",
  "value": ["thisWeek"]
}
```
后端需要把 `"thisWeek"` 转为具体的日期范围:
```
thisWeek     → [本周一00:00, 本周日23:59]
today        → [今天00:00, 今天23:59]
lastNDays    → [今天-N, 今天]
thisMonth    → [本月1号, 本月最后一天]
past         → [< 今天]
future       → [> 今天]
```

---

## 二、筛选条件的存储

筛选条件是**视图配置**的一部分，存储在 views 表中:

```sql
-- 视图表中的 filter 字段
UPDATE views SET config = jsonb_set(config, '{filter}', $1) WHERE id = $2;
```

config 中保存:
```json
{
  "filter": {
    "conjunction": "and",
    "filters": [...]
  },
  "sort": [...],
  "group": [...],
  "frozenColumnCount": 1,
  "columns": [...]
}
```

**每个视图有独立的筛选配置**，同一份数据不同视图可以有不同的筛选条件。

---

## 三、后端: Filter JSON → SQL 转换

这是最核心的部分。后端需要一个 **Filter Engine** 把声明式的 Filter JSON 翻译成 SQL:

```typescript
class FilterEngine {
  // 主入口: 把 Filter JSON 转为 SQL WHERE 子句
  toSQL(filter: FilterDSL, fieldMap: Map<string, FieldDef>): { sql: string; params: any[] }

  // 单个条件转SQL
  private conditionToSQL(condition: FilterCondition, field: FieldDef): { sql: string; params: any[] }

  // 递归处理嵌套条件组
  private groupToSQL(group: FilterGroup, fieldMap: Map<string, FieldDef>): { sql: string; params: any[] }
}
```

### 转换示例

**输入 Filter JSON:**
```json
{
  "conjunction": "and",
  "filters": [
    {"fieldId": "fld_status", "operator": "is", "value": ["已完成"]},
    {"fieldId": "fld_amount", "operator": "isGreater", "value": [1000]}
  ]
}
```

**输出 SQL (JSONB方案):**
```sql
WHERE table_id = $1
  AND data->>'fld_status' = $2
  AND (data->>'fld_amount')::numeric > $3
-- 参数: ['xxx', '已完成', 1000]
```

### 不同字段类型的SQL生成

| 字段类型 | JSONB查询方式 |
|---------|-------------|
| 文本 | `data->>'fieldId' = $1` |
| 数字 | `(data->>'fieldId')::numeric > $1` |
| 单选 | `data->>'fieldId' = $1` |
| 多选 | `data->'fieldId' ? $1` (JSONB包含查询) |
| 日期 | `(data->>'fieldId')::bigint > $1` (时间戳比较) |
| 复选框 | `(data->>'fieldId')::boolean = true` |
| isEmpty | `data->>'fieldId' IS NULL OR data->>'fieldId' = ''` |

### 嵌套AND/OR的SQL生成
```typescript
// 递归处理
toSQL(filter: FilterDSL, fieldMap: FieldMap): { sql: string; params: any[] } {
  const parts: string[] = [];
  const allParams: any[] = [];

  // 处理当前层级的 filters
  for (const f of filter.filters) {
    const field = fieldMap.get(f.fieldId);
    const { sql, params } = this.conditionToSQL(f, field);
    parts.push(sql);
    allParams.push(...params);
  }

  // 递归处理嵌套 group
  if (filter.group) {
    for (const g of filter.group) {
      const { sql, params } = this.toSQL(g, fieldMap);
      parts.push(`(${sql})`);
      allParams.push(...params);
    }
  }

  const conjunction = filter.conjunction === 'or' ? ' OR ' : ' AND ';
  return {
    sql: parts.join(conjunction),
    params: allParams
  };
}
```

---

## 四、前端: 筛选UI组件

### 筛选面板设计
```
┌──────────────────────────────────────────┐
│  筛选条件                                 │
│                                          │
│  [状态] [等于▼] [已完成✕]         [×删除] │
│  [金额] [大于▼] [1000  ✕]         [×删除] │
│  [+ 添加条件]  [+ 添加条件组]             │
│                                          │
│  匹配 [所有条件▼(AND/OR)]                 │
│                                          │
│  [应用筛选]  [重置]                       │
└──────────────────────────────────────────┘
```

### 前端组件结构
```typescript
// 筛选条件编辑器
interface FilterEditorProps {
  value: FilterDSL;
  fields: FieldDef[];          // 当前表的所有字段
  onChange: (filter: FilterDSL) => void;
}

// 单行条件编辑器
interface FilterConditionRowProps {
  condition: FilterCondition;
  fields: FieldDef[];
  onChange: (condition: FilterCondition) => void;
  onRemove: () => void;
}
```

### UI交互流程
```
1. 用户点击"筛选"按钮
2. 弹出筛选面板
3. 点击"添加条件"
   → 选择字段(下拉列表)
   → 选择操作符(根据字段类型动态显示)
   → 输入/选择值(根据字段类型提供不同输入控件)
4. 可继续添加条件或条件组
5. 选择 AND / OR
6. 点击"应用"
   → 前端将 Filter JSON 保存到视图配置
   → 调用 API 获取筛选后的数据
   → 表格刷新
```

### 操作符根据字段类型动态变化
```typescript
function getOperatorsForField(fieldType: FieldType): Operator[] {
  switch (fieldType) {
    case 'text':
      return ['is', 'isNot', 'contains', 'doesNotContain', 'isEmpty', 'isNotEmpty'];
    case 'number':
      return ['equal', 'notEqual', 'greater', 'less', 'greaterEqual', 'lessEqual', 'isEmpty'];
    case 'date':
      return ['is', 'isBefore', 'isAfter', 'isEmpty', 'isWithin'];
    case 'singleSelect':
      return ['is', 'isNot', 'isEmpty', 'isNotEmpty'];
    case 'checkbox':
      return ['isChecked', 'isNotChecked'];
    // ...
  }
}
```

### 值输入控件根据字段类型变化
| 字段类型 | 值输入控件 |
|---------|-----------|
| 文本 | 文本输入框 |
| 数字 | 数字输入框 |
| 单选 | 下拉选项列表(从字段配置中获取选项) |
| 多选 | 多选下拉(从字段配置中获取选项) |
| 日期 | 日期选择器 + 相对日期快捷选项(今天/本周/本月) |
| 人员 | 人员选择器(从团队成员中选择) |
| 复选框 | 无需输入值( isChecked/isNotChecked ) |

---

## 五、筛选执行的两个路径

### 路径A: 服务端筛选 (大数据量)
```
前端Filter JSON → API请求 → 后端Filter Engine → SQL查询 → 返回结果
```
适合: 数据量大(>1万行)，服务端分页

### 路径B: 客户端筛选 (小数据量/实时响应)
```
前端Filter JSON → 本地内存过滤 → 即时刷新UI
```
适合: 数据已全量加载到前端，筛选条件变化频繁时即时响应

```typescript
// 客户端内存筛选
function filterRecords(records: Record[], filter: FilterDSL, fieldMap: FieldMap): Record[] {
  return records.filter(record => {
    return matchFilter(record, filter, fieldMap);
  });
}

function matchFilter(record: Record, filter: FilterDSL, fieldMap: FieldMap): boolean {
  const results = filter.filters.map(f => matchCondition(record, f, fieldMap));

  if (filter.group) {
    for (const g of filter.group) {
      results.push(matchFilter(record, g, fieldMap));
    }
  }

  return filter.conjunction === 'and'
    ? results.every(Boolean)
    : results.some(Boolean);
}
```

### 推荐策略: 混合模式
```
数据量 < 1万行: 客户端筛选(即时响应，无需请求服务端)
数据量 > 1万行: 服务端筛选(分页查询)
自动判断: 加载数据时如果总量超过阈值，自动切换为服务端筛选
```

---

## 六、排序和分组 (与筛选紧密配合)

### 排序
```json
{
  "sort": [
    {"fieldId": "fld_priority", "order": "desc"},
    {"fieldId": "fld_deadline", "order": "asc"}
  ]
}
```
SQL: `ORDER BY (data->>'fld_priority') DESC, (data->>'fld_deadline') ASC`

### 分组
```json
{
  "group": [
    {"fieldId": "fld_status"}
  ]
}
```
分组 = 按字段值分组 + 组内排序，前端渲染为分组标题行 + 组内数据行。

---

## 七、筛选 + 排序 + 分组的完整API

```typescript
// 前端请求
interface DataQuery {
  tableId: string;
  viewId: string;
  filter?: FilterDSL;          // 筛选条件
  sort?: SortDef[];            // 排序
  group?: GroupDef[];          // 分组
  page?: number;               // 分页
  pageSize?: number;
}

// 后端处理
async function queryRecords(query: DataQuery): Promise<PagedResult> {
  // 1. 从视图配置获取 filter/sort/group (如果前端没传则用视图默认)
  const filter = query.filter || view.config.filter;
  const sort = query.sort || view.config.sort;

  // 2. Filter Engine 生成 SQL
  const { sql: whereClause, params } = filterEngine.toSQL(filter, fieldMap);
  const orderClause = sortEngine.toSQL(sort, fieldMap);

  // 3. 执行查询
  const records = await db.query(`
    SELECT * FROM records
    WHERE table_id = $1 AND ${whereClause}
    ${orderClause}
    LIMIT $${params.length + 2} OFFSET $${params.length + 3}
  `, [query.tableId, ...params, query.pageSize, offset]);

  return { records, total };
}
```

---

## 八、性能优化

### 筛选性能
| 优化策略 | 说明 |
|---------|------|
| **JSONB函数索引** | 为高频筛选字段创建表达式索引 |
| **客户端缓存** | 小数据量全量缓存到前端，筛选走内存 |
| **预计算** | 频繁的筛选条件可预计算结果缓存到Redis |
| **DuckDB分析** | 复杂聚合筛选可走DuckDB列式引擎 |

### 动态索引策略
```sql
-- 用户首次按某字段筛选时，自动创建索引
-- 监控筛选操作频率，热门字段自动建索引
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_filter_fld123
ON records (((data->>'fld123')));

-- 数字字段用btree索引更精确
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_filter_fld456_num
ON records (((data->>'fld456')::numeric));
```

---

## 总结: 用户操作到数据查询的完整链路

```
1. 用户点击"筛选"按钮
2. 选择字段 → 选择操作符 → 输入值
3. 前端组装 Filter JSON
4. 判断数据量: 小→客户端筛选; 大→服务端筛选
5. 服务端: Filter Engine 解析 Filter JSON → 生成参数化SQL → 执行查询
6. 返回结果 → 前端渲染
7. Filter JSON 保存到视图配置 (下次打开视图自动应用)
```

**全程用户不需要写一行SQL，只需要在UI上点选。**

## 参考链接
- [飞书多维表格API筛选文档](https://open.feishu.cn/document/server-docs/docs/bitable-v1/bitable-overview)
- [Metabase可视化查询构建器](https://www.metabase.com/docs/latest/questions/query-builder/editor)
- [Active Query Builder组件](https://www.activequerybuilder.com/product.html)
- [Notion数据库筛选](https://www.notion.com/help/guides/filters)
- [Airtable筛选](https://support.airtable.com/docs/guide-to-views)
