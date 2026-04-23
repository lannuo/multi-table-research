# Canvas 表格渲染引擎深度研究

## 概述
本文档深入研究多维表格产品前端 Canvas 渲染引擎的完整实现方案，涵盖渲染管线、编辑器覆盖层、虚拟滚动、命中测试、APITable 源码分析及性能优化策略。基于已确定的技术选型（React + Next.js + Canvas 自定义渲染），参考 APITable 的 Konva.js 方案。

---

## 一、APITable Canvas 渲染架构（源码分析）

### 1.1 核心技术选型：Konva.js

APITable 的网格视图渲染引擎基于 **Konva.js**（一个 2D Canvas 绘图框架），而非原生 Canvas API 直接操作。源码位于 `packages/datasheet/src/pc/components/konva_grid/`。

**关键发现**：
- **Konva.pixelRatio = 2** — 强制设置 2 倍像素密度，确保 Retina 屏幕清晰渲染
- Konva 提供 Stage > Layer > Group > Shape 的层级结构，类似 DOM 树，但全部在 Canvas 上绘制
- 使用 `dynamic(() => import(...), { ssr: false })` 动态加载 Konva 组件，避免 SSR 兼容问题

**源码路径**：`konva_grid_stage.tsx`

### 1.2 双坐标系架构

APITable 采用 **Canvas 坐标系 + DOM 坐标系** 双系统设计：

1. **Canvas 画布（KonvaGrid）**：负责绘制表格网格、单元格内容、选中态、协作头像等所有视觉元素
2. **DOM 层（DomGrid）**：覆盖在 Canvas 之上，承载编辑器（Editor）、右键菜单（ContextMenu）、字段设置面板等需要真实 DOM 交互的组件

**源码路径**：
- `konva_grid.tsx` — Canvas 层
- `dom_grid.tsx` — DOM 覆盖层

### 1.3 坐标系统（Coordinate Model）

`Coordinate` 基类是整个渲染引擎的核心，负责行/列坐标计算：

```
Coordinate（基类）
├── GridCoordinate（网格视图）
└── GanttCoordinate（甘特图视图）
```

**关键机制**：
- **增量式元数据缓存**：`rowMetaDataMap` 和 `columnMetaDataMap` 缓存已计算的行/列偏移量和尺寸，避免每次都从头遍历
- `lastRowIndex` / `lastColumnIndex` 记录最后计算到的索引，新增行列时只计算增量部分
- **二分查找定位**：`_findNearestCellIndexByBinary()` 使用二分法快速定位滚动位置对应的行列索引
- **异常映射表**：`rowIndicesMap` 和 `columnIndicesMap` 支持行高/列宽的动态调整（不同行可以有不同高度）

### 1.4 虚拟滚动实现

APITable 的虚拟滚动实现分 **垂直** 和 **水平** 两个维度独立计算：

```typescript
// 计算可见行范围
const getVerticalRangeInfo = () => {
    const startIndex = instance.getRowStartIndex(scrollTop);
    const stopIndex = instance.getRowStopIndex(startIndex, scrollTop);
    return { rowStartIndex, rowStopIndex };
};

// 计算可见列范围
const getHorizontalRangeInfo = () => {
    const startIndex = instance.getColumnStartIndex(scrollLeft);
    const stopIndex = instance.getColumnStopIndex(startIndex, scrollLeft);
    return { columnStartIndex, columnStopIndex };
};
```

**冻结列处理**：冻结列不参与虚拟化，始终渲染。通过 `frozenColumnCount` 和 `frozenColumnWidth` 单独管理。

**滚动留白**：`GRID_SCROLL_REMAIN_SPACING = 200px` 预留额外的滚动缓冲区。

### 1.5 单元格渲染系统

每种字段类型都有独立的 Canvas 渲染组件：

```
cell/
├── cell_text/          — 文本、URL、邮件、电话
├── cell_formula/       — 公式
├── cell_checkbox/      — 复选框
├── cell_single_select/ — 单选
├── cell_multi_select/  — 多选
├── cell_member/        — 成员（含头像）
├── cell_attachment/    — 附件
├── cell_link/          — 关联字段
├── cell_lookup/        — 引用字段
├── cell_rating/        — 评分
├── cell_button/        — 按钮（含加载动画）
├── cell_workdoc.tsx    — 文档类型
└── cell_value.tsx      — 统一渲染入口
```

**渲染模式**：采用 `useGridCells` hook 中的 `cellsDrawer()` 方法，直接操作 Canvas Context 绘制，而非通过 Konva React 组件（后者性能不够好）：

```typescript
const cellsDrawer = (ctx, columnStartIndex, columnStopIndex) => {
    cellHelper.initCtx(ctx);
    for (let columnIndex = columnStartIndex; columnIndex <= columnStopIndex; columnIndex++) {
        for (let rowIndex = rowStartIndex; rowIndex <= rowStopIndex; rowIndex++) {
            switch (type) {
                case CellType.Add:     addRowLayout.render(...)
                case CellType.Blank:   blankRowLayout.render(...)
                case CellType.GroupTab: groupTabLayout.render(...)
                case CellType.Record:  recordRowLayout.render(...)
            }
        }
    }
};
```

### 1.6 绘图工具类（KonvaDrawer）

`KonvaDrawer` 封装了原生 Canvas API 的业务绘图方法：

- **文本省略**：`textEllipsis()` — 根据最大宽度自动截断并添加省略号，使用 `GraphemeSplitter` 正确处理 emoji 等 Unicode 代理对
- **文本宽度缓存**：`getTextWidth()` 使用 Canvas `measureText()` 并缓存结果到 `textDataCache`
- **图片缓存**：`imageCache` 模块预加载图片并缓存，支持 `crossOrigin` 设置
- **绘图原语**：`line()`, `rect()`, `label()`, `wrapText()` 等封装方法

### 1.7 Layout 系统

基于 `Coordinate` 基类，派生出 4 种行布局：

| 布局类 | 职责 |
|--------|------|
| `RecordRowLayout` | 数据记录行渲染 |
| `GroupTabLayout` | 分组标题行渲染 |
| `BlankRowLayout` | 空白行渲染 |
| `AddRowLayout` | 添加行按钮渲染 |

每种 Layout 都有 `init()` 和 `render()` 方法，`init()` 设置坐标和尺寸，`render()` 执行绘制。

### 1.8 事件处理

- **鼠标事件**：通过 Konva Stage 的 `onMouseMove` 事件，使用 `requestAnimationFrame` 节流
- **坐标转换**：`getMousePosition()` 将 Canvas 像素坐标转换为行列索引（通过二分查找）
- **区域判断**：区分 Grid 区域、冻结区域、行头区域等不同交互区域

### 1.9 常量配置

```
GRID_ROW_HEAD_WIDTH = 70px            — 行头宽度
GRID_FIELD_HEAD_HEIGHT = 40px         — 列头高度
GRID_DEFAULT_VERTICAL_SPACING = 70px  — 垂直滚动触发阈值
GRID_DEFAULT_HORIZONTAL_SPACING = 70px — 水平滚动触发阈值
GRID_CELL_VALUE_PADDING = 10px        — 单元格内边距
GRID_ICON_COMMON_SIZE = 16px          — 图标通用尺寸
```

---

## 二、Canvas 表格渲染通用架构

### 2.1 DOM vs Canvas 渲染对比

| 维度 | DOM 渲染 | Canvas 渲染 |
|------|----------|-------------|
| 性能上限 | ~1万行 | 10万+行 |
| 内存占用 | 高（每个单元格是 DOM 节点） | 低（像素绘制） |
| 文本选择 | 原生支持 | 需要自己实现 |
| 输入框 | 原生 | 需要 DOM 覆盖层 |
| 无障碍(a11y) | 原生支持 | 需要额外实现 |
| 开发复杂度 | 低 | 高 |
| CSS 样式 | 直接使用 | 需要手动绘制 |

### 2.2 混合渲染模式（推荐方案）

采用 **Canvas 绘制 + DOM 编辑器覆盖** 的混合模式：

1. **Canvas 层**：绘制表格网格、单元格内容、选中态、滚动条
2. **DOM 覆盖层**：在编辑时动态创建 `<input>` / `<textarea>` 并定位到对应单元格位置
3. **DOM 覆盖层**：承载右键菜单、tooltip、字段设置面板等

架构图：
```
┌──────────────────────────────────────────┐
│              DOM 覆盖层 (absolute)         │
│  ┌─────────────────┐  ┌──────────────┐   │
│  │  单元格编辑器     │  │  右键菜单     │   │
│  │  (input/date/..) │  │  (context)    │   │
│  └─────────────────┘  └──────────────┘   │
├──────────────────────────────────────────┤
│              Canvas 层 (Konva.js)         │
│  ┌────────────────────────────────────┐  │
│  │  Grid Layer: 网格线、行头、列头      │  │
│  ├────────────────────────────────────┤  │
│  │  Cell Layer: 单元格内容渲染         │  │
│  ├────────────────────────────────────┤  │
│  │  Selection Layer: 选区高亮          │  │
│  ├────────────────────────────────────┤  │
│  │  Collaboration Layer: 协作头像      │  │
│  └────────────────────────────────────┘  │
└──────────────────────────────────────────┘
```

---

## 三、Canvas 渲染管线

### 3.1 单元格渲染管线

```
数据变更 → 标记脏区域 → measure（计算尺寸） → layout（确定位置） → paint（绘制像素）
```

**Measure 阶段**：
- 使用 Canvas `measureText()` 计算文本宽度
- 查询缓存获取列宽和行高
- 计算单元格实际所需尺寸

**Layout 阶段**：
- 根据 Coordinate 系统确定每个可见单元格的 (x, y, width, height)
- 处理冻结行列的特殊定位

**Paint 阶段**：
- 清除脏区域（`clearRect`）
- 绘制背景色（交替行色、选中色）
- 绘制单元格内容（按类型分发到对应渲染器）
- 绘制网格线
- 绘制选区高亮

### 3.2 脏区域追踪

只重绘发生变化的区域，而非整个画布：

```typescript
interface DirtyRegion {
    x: number;
    y: number;
    width: number;
    height: number;
}

// 标记脏区域
const markDirty = (rowIndex: number, colIndex: number) => {
    const region = getCellRect(rowIndex, colIndex);
    dirtyRegions.push(region);
};

// 合并重叠的脏区域
const mergeDirtyRegions = (regions: DirtyRegion[]): DirtyRegion[] => {
    // 使用扫描线算法合并重叠区域
};

// 重绘
const repaint = () => {
    const merged = mergeDirtyRegions(dirtyRegions);
    for (const region of merged) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(region.x, region.y, region.width, region.height);
        ctx.clip();
        drawCells(ctx, region);
        ctx.restore();
    }
    dirtyRegions = [];
};
```

### 3.3 分层合成策略

| 层级 | 内容 | 重绘频率 |
|------|------|----------|
| 网格层 (Grid) | 行列线、行头、列头 | 低（只在结构调整时） |
| 内容层 (Content) | 单元格文本/图标/标签 | 中（数据变更时） |
| 选区层 (Selection) | 当前选中区域高亮 | 高（每次选择变化） |
| 协作层 (Collaboration) | 其他用户光标/选区 | 高（实时更新） |

---

## 四、编辑器覆盖层设计

### 4.1 核心机制

APITable 的 `DomGrid` 组件是编辑器的承载容器：

1. 通过 `rectCalculator()` 计算当前激活单元格在页面上的精确像素位置
2. 编辑器组件 `PureEditorContainer` 定位到该位置
3. 编辑器类型根据字段类型自动选择（文本编辑器、日期选择器、成员选择器等）
4. 编辑完成后通过 `toggleEdit` 关闭编辑器

### 4.2 关键坐标转换

```typescript
const rectCalculator = ({ recordId, fieldId }) => {
    const cellUIIndex = getCellUIIndex(state, { recordId, fieldId });
    const { rowIndex, columnIndex } = cellUIIndex;
    const top = instance.getRowOffset(rowIndex);
    const left = instance.getColumnOffset(columnIndex);
    const width = instance.getColumnWidth(columnIndex);
    const height = instance.getRowHeight(rowIndex);
    // 加上容器偏移和滚动偏移
    return { top, left, width, height };
};
```

### 4.3 编辑器生命周期

```
双击/回车 → 进入编辑态 → 创建 DOM 编辑器 → 定位到单元格 → 自动聚焦
    ↓
编辑中 → onChange 更新本地状态 → 覆盖层跟随滚动
    ↓
Enter/Tab/点击外部 → 提交值 → 关闭编辑器 → 触发 OT 操作
Escape → 取消编辑 → 关闭编辑器 → 恢复原始值
```

### 4.4 不同类型编辑器

| 字段类型 | 编辑器组件 | 特殊处理 |
|----------|-----------|----------|
| 文本 | textarea（自适应高度） | Shift+Enter 换行，Enter 提交 |
| 数字 | input[type=number] | 千分位格式化 |
| 日期 | DatePicker 弹出层 | 弹出层需要正确定位，不被裁剪 |
| 单选 | Select 下拉 | 下拉列表需超出 Canvas 容器 |
| 多选 | MultiSelect 下拉 | 支持搜索、键盘导航 |
| 成员 | MemberSelect 弹出层 | 头像 + 搜索列表 |
| 附件 | 文件上传区域 | 拖拽上传 + 粘贴上传 |
| 关联 | RecordPicker 弹出层 | 搜索其他表的记录 |

---

## 五、虚拟滚动深度实现

### 5.1 双轴虚拟化算法

```
可见起始行 = 二分查找(scrollTop, 行偏移量数组)
可见结束行 = 二分查找(scrollTop + containerHeight, 行偏移量数组)
可见起始列 = 二分查找(scrollLeft, 列偏移量数组)
可见结束列 = 二分查找(scrollLeft + containerWidth, 列偏移量数组)
```

时间复杂度 O(log n)，APITable 使用增量式元数据缓存实现。

### 5.2 可变行高/列宽处理

```
rowOffsetMap: Map<rowIndex, { offset, height }>
columnOffsetMap: Map<colIndex, { offset, width }>

// 增量计算：只在新增/修改时重新计算
if (changedIndex > lastComputedIndex) {
    for (let i = lastComputedIndex; i <= changedIndex; i++) {
        offsetMap[i] = {
            offset: offsetMap[i-1].offset + offsetMap[i-1].height,
            height: getRowHeight(i) // 可能从用户自定义或默认值
        };
    }
    lastComputedIndex = changedIndex;
}
```

### 5.3 缓冲区管理

```
┌───────────────────────────────────┐
│         可视区域 (viewport)         │
│  ┌─────────────────────────────┐  │
│  │     缓冲区 (buffer)          │  │
│  │  ┌───────────────────────┐  │  │
│  │  │   实际渲染区域         │  │  │
│  │  │   = viewport + buffer │  │  │
│  │  └───────────────────────┘  │  │
│  └─────────────────────────────┘  │
└───────────────────────────────────┘
```

APITable 使用 `GRID_SCROLL_REMAIN_SPACING = 200px` 作为缓冲区，额外渲染可视区域外的 200px 内容，减少快速滚动时的白屏。

### 5.4 冻结行/列处理

- 冻结区域（行头、固定列）始终渲染，不参与虚拟化
- Canvas 使用 `clipX/clipY/clipWidth/clipHeight` 裁剪，将冻结区域和非冻结区域分开绘制
- 非冻结区域的 Group 使用 `offsetX/offsetY` 实现滚动偏移

### 5.5 分组/小节标题

分组标题行（GroupTabLayout）作为特殊行类型参与虚拟滚动：
- 分组标题行的行高与普通数据行不同
- 折叠/展开操作会影响行索引映射（`rowIndicesMap`）
- 展开时动态插入子行，收起时移除

---

## 六、命中测试与交互

### 6.1 鼠标坐标 → 单元格位置

```typescript
const hitTest = (mouseX: number, mouseY: number): CellPosition | null => {
    // 1. 判断是否在行头区域
    if (mouseX < GRID_ROW_HEAD_WIDTH) {
        // 返回行头区域
    }

    // 2. 判断是否在列头区域
    if (mouseY < GRID_FIELD_HEAD_HEIGHT) {
        // 返回列头区域
    }

    // 3. 二分查找行列索引
    const rowIndex = binarySearch(rowOffsets, mouseY + scrollTop);
    const colIndex = binarySearch(colOffsets, mouseX + scrollLeft);

    return { rowIndex, colIndex };
};
```

### 6.2 交互类型检测

| 交互 | 触发条件 | 处理 |
|------|----------|------|
| 单击选择 | mousedown + mouseup 同一单元格 | 设置选中单元格 |
| 区域选择 | mousedown + mousemove | 起始单元格 → 当前单元格的矩形范围 |
| 整行选择 | 点击行头 | 选择整行 |
| 整列选择 | 点击列头 | 选择整列 |
| 列宽调整 | 鼠标在列头右边缘 ±3px | cursor: col-resize, 拖拽调整 |
| 行高调整 | 鼠标在行头下边缘 ±3px | cursor: row-resize, 拖拽调整 |
| 拖拽排序 | 拖拽行头 | 行排序动画 |
| 双击编辑 | dblclick | 进入编辑态 |
| 右键菜单 | contextmenu | 在鼠标位置弹出菜单 |

### 6.3 触摸屏手势

| 手势 | 操作 |
|------|------|
| 单指滑动 | 滚动表格 |
| 双指捏合 | 缩放（可选） |
| 长按 | 选中单元格 + 弹出菜单 |
| 双击 | 进入编辑 |

---

## 七、性能优化策略

### 7.1 APITable 验证过的优化手段

| 优化手段 | 说明 |
|----------|------|
| Konva.js + 原生 Canvas API 混合 | 结构化绘制用 Konva，高频绘制用原生 API |
| 增量元数据缓存 | 行/列偏移量只计算一次，后续 O(1) 查找 |
| 二分查找定位 | 滚动时行列索引查找 O(log n) |
| requestAnimationFrame 节流 | 鼠标移动和滚动事件 |
| 文本宽度缓存 | `measureText()` 结果缓存，避免重复计算 |
| 图片预加载缓存 | 附件和头像的图片预加载 |
| Konva.pixelRatio = 2 | Retina 屏幕适配 |
| 双坐标系 | Canvas 绘制 + DOM 覆盖，各司其职 |
| dynamic import | Konva 组件 SSR 兼容 |

### 7.2 通用优化建议

1. **避免在渲染循环中创建对象** — 预分配所有缓冲区
2. **使用 OffscreenCanvas** — 将绘制任务转移到 Web Worker
3. **分层渲染** — 将静态层（网格线）和动态层（单元格内容）分开绘制
4. **脏矩形重绘** — 只重绘变化的区域，而非整个画布
5. **WebGL 后端** — 对于 50万+ 行的超大数据集，考虑 WebGL（如 Deck.gl、PixiJS）
6. **数据虚拟化** — 配合后端分页/游标，前端永远只持有可见数据

### 7.3 性能目标

| 场景 | 目标帧率 | 说明 |
|------|----------|------|
| 静态渲染 | 60fps | 万行数据，无操作 |
| 滚动 | 60fps | 快速滚动无明显卡顿 |
| 编辑单个单元格 | <16ms | 从点击到编辑器出现 |
| 批量粘贴 | <100ms | 100行粘贴操作 |
| 排序/筛选 | <500ms | 1万行数据排序 |

### 7.4 对比其他方案

| 方案 | 渲染方式 | 性能上限 | 适用场景 |
|------|----------|----------|----------|
| AG Grid | 虚拟 DOM + CSS Transform | 10万行 | 通用表格 |
| Handsontable | 虚拟 DOM | 10万行 | 类 Excel |
| Google Sheets | Canvas + DOM 混合 | 百万行 | 大规模电子表格 |
| APITable | Konva.js (Canvas) + DOM | 10万行 | 多维表格 |
| Excel Online | Canvas | 百万行 | 专业电子表格 |

---

## 参考链接

### APITable 源码
- [APITable GitHub Repository](https://github.com/apitable/apitable)
- [konva_grid 模块 README](https://github.com/apitable/apitable/blob/develop/packages/datasheet/src/pc/components/konva_grid/readme.md)
- [Coordinate 坐标系统](https://github.com/apitable/apitable/blob/develop/packages/datasheet/src/pc/components/konva_grid/model/coordinate/coordinate.ts)
- [GridCoordinate](https://github.com/apitable/apitable/blob/develop/packages/datasheet/src/pc/components/konva_grid/model/coordinate/grid_coordinate.ts)
- [KonvaGridStage 虚拟滚动](https://github.com/apitable/apitable/blob/develop/packages/datasheet/src/pc/components/konva_grid/konva_grid_stage.tsx)
- [DomGrid 编辑器覆盖](https://github.com/apitable/apitable/blob/develop/packages/datasheet/src/pc/components/konva_grid/dom_grid.tsx)
- [KonvaDrawer 绘图工具](https://github.com/apitable/apitable/blob/develop/packages/datasheet/src/pc/components/konva_grid/utils/drawer.ts)
- [Image Cache 图片缓存](https://github.com/apitable/apitable/blob/develop/packages/datasheet/src/pc/components/konva_grid/utils/image_cache.ts)
- [useGridCells 渲染 Hook](https://github.com/apitable/apitable/blob/develop/packages/datasheet/src/pc/components/konva_grid/hooks/use_grid_cells.tsx)
- [Cell Text 文本渲染](https://github.com/apitable/apitable/blob/develop/packages/datasheet/src/pc/components/konva_grid/components/cell/cell_text/cell_text.tsx)
- [Grid Constants](https://github.com/apitable/apitable/blob/develop/packages/datasheet/src/pc/components/konva_grid/constant.ts)

### 通用参考
- [Konva.js 官方文档](https://konvajs.org/)
- [AG Grid DOM Virtualisation](https://www.ag-grid.com/javascript-data-grid/dom-virtualisation/)
- [虚拟滚动详解 - Dev.to](https://dev.to/lalitkhu/rendering-massive-tables-at-lightning-speed-virtualization-with-virtual-scrolling-2dpp)
- [React虚拟滚动固定行列](https://gearheart.io/blog/smooth-react-virtual-scroll-with-fixed-rows-columns/)
