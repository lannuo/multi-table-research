# 公式引擎技术方案

## HyperFormula (推荐)
- **GitHub**: https://github.com/handsontable/hyperformula
- **语言**: TypeScript/JavaScript
- **许可证**: MIT (开源)
- **核心特点**:
  - **400+ Excel公式**兼容
  - 无头(headless)设计，可独立于UI使用
  - 支持CRUD操作、撤销重做、剪贴板
  - 依赖图(Dependency Graph)支持
  - 可在Web Worker中运行
  - 由Handsontable团队维护

## Formula.JS
- JavaScript实现的公式库
- 较为轻量
- Grid.is团队在自研引擎时参考了Formula.JS

## 其他参考实现
- **Apache POI** (Java): 电子表格处理库
- **OpenOffice Calc** (C++): 完整开源电子表格应用

## 自研 vs 使用现有方案
- **使用HyperFormula**: 快速起步，400+公式开箱即用，MIT许可友好
- **自研**: 可完全控制，但工作量巨大，需要处理循环引用、依赖排序等复杂问题
- **建议**: 初期使用HyperFormula，后续按需自研特殊公式

## 参考链接
- [HyperFormula GitHub](https://github.com/handsontable/hyperformula)
- [HyperFormula介绍](https://handsontable.com/blog/introducing-hyperformula-fast-javascript-calculation-engine)
- [Excel-like能力集成](https://handsontable.com/blog/supercharge-your-web-application-with-excel-like-capabilities-from-hyperformula)
- [自研电子表格引擎经验](https://medium.grid.is/we-built-a-spreadsheet-engine-from-scratch-heres-what-we-learned-e4800ab9edf1)
- [Handsontable公式插件](https://handsontable.com/docs/javascript-data-grid/api/formulas/)
