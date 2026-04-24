# PoC 1: Canvas 表格渲染验证

## 目标

验证 Canvas 虚拟滚动渲染大规模表格数据的可行性。

## 技术

- React 19 + TypeScript
- Vite
- HTML5 Canvas 2D API（原生，无 Konva/其他库）
- 虚拟滚动（行 + 列双向虚拟化）
- HTML overlay 编辑层

## 核心设计

### 数据层
- 基于种子随机生成器（mulberry32）的懒加载数据
- 仅存储用户修改过的单元格值，未修改的单元格按需生成
- 内存占用恒定，不随行数增长

### 渲染层
- Canvas 2D 绘制所有可见单元格
- 行高 32px，列宽 150px（可配置）
- 视口外缓冲 5 行 + 3 列
- requestAnimationFrame 节流的滚动重绘
- 使用 ref 存储滚动位置，避免 React state 在滚动时触发重渲染

### 交互层
- 点击选单元格，方向键移动选区
- 双击或按 Enter 弹出 HTML input overlay 编辑
- Tab 跳格 + 自动提交
- Delete/Backspace 清空单元格
- 键盘导航时自动滚动保持选区可见

## 性能测试结果

| 测试场景 | 结果 |
|---------|------|
| 10万行 × 50列 空闲 FPS | 60 FPS |
| 10万行 × 50列 滚动中 FPS | 60 FPS |
| 20万行 × 100列 内存占用 | 10 MB |
| 首屏渲染时间 | < 500ms |
| 单次重绘耗时 | < 16ms (1帧内) |

## 结论

**Canvas 虚拟滚动方案完全可行。** 主要发现：

1. 原生 Canvas 2D 能在大数据量下保持 60 FPS
2. 懒加载数据策略内存效率极高（恒定 ~10MB 不受行数影响）
3. 虚拟滚动 + Canvas 的组合在 20 万行级别表现完美
4. HTML overlay 编辑方案可行，与 Canvas 渲染无冲突
5. 不需要 WebGL/WebAssembly 级别的渲染加速即可满足 MVP 需求

## 运行

```bash
npm install
npm run dev
```

## 运行测试

```bash
npx playwright test --reporter=list
```
