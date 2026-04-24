import { useState, useMemo } from "react";
import CanvasTable from "./CanvasTable";
import PerformanceOverlay from "./PerformanceOverlay";
import { DataStore } from "./data";

export default function App() {
  const [rowCount, setRowCount] = useState(10000);
  const [colCount, setColCount] = useState(50);
  const [key, setKey] = useState(0);

  const data = useMemo(
    () => new DataStore(rowCount, colCount),
    [rowCount, colCount, key]
  );

  const presetRows = [1000, 10000, 50000, 100000, 200000];
  const presetCols = [10, 20, 50, 100];

  return (
    <div style={{ width: "100vw", height: "100vh", display: "flex", flexDirection: "column" }}>
      {/* Toolbar */}
      <div
        style={{
          display: "flex",
          gap: 16,
          alignItems: "center",
          padding: "8px 16px",
          borderBottom: "1px solid #dee2e6",
          background: "#fff",
          flexWrap: "wrap",
        }}
      >
        <span style={{ fontWeight: 600, fontSize: 14 }}>Canvas 表格渲染 PoC</span>

        <span style={{ color: "#868e96", fontSize: 12 }}>行数:</span>
        {presetRows.map((n) => (
          <button
            key={n}
            onClick={() => setRowCount(n)}
            style={{
              padding: "4px 10px",
              border: rowCount === n ? "2px solid #4c6ef5" : "1px solid #dee2e6",
              borderRadius: 4,
              background: rowCount === n ? "#e7f5ff" : "#fff",
              cursor: "pointer",
              fontSize: 12,
            }}
          >
            {n >= 10000 ? `${n / 10000}万` : n}
          </button>
        ))}

        <span style={{ color: "#868e96", fontSize: 12 }}>列数:</span>
        {presetCols.map((n) => (
          <button
            key={n}
            onClick={() => setColCount(n)}
            style={{
              padding: "4px 10px",
              border: colCount === n ? "2px solid #4c6ef5" : "1px solid #dee2e6",
              borderRadius: 4,
              background: colCount === n ? "#e7f5ff" : "#fff",
              cursor: "pointer",
              fontSize: 12,
            }}
          >
            {n}
          </button>
        ))}

        <span style={{ color: "#adb5bd" }}>|</span>

        <button
          onClick={() => setKey((k) => k + 1)}
          style={{
            padding: "4px 10px",
            border: "1px solid #dee2e6",
            borderRadius: 4,
            background: "#fff",
            cursor: "pointer",
            fontSize: 12,
          }}
        >
          重新生成数据
        </button>

        <span style={{ color: "#868e96", fontSize: 11, marginLeft: "auto" }}>
          点击选单元格 | 方向键导航 | 回车编辑 | Tab 跳格 | Delete 清空
        </span>
      </div>

      {/* Table */}
      <div style={{ flex: 1, overflow: "hidden" }}>
        <CanvasTable key={`${rowCount}-${colCount}-${key}`} data={data} />
      </div>

      <PerformanceOverlay />
    </div>
  );
}
