import { useRef, useEffect, useCallback, useState } from "react";
import { DataStore } from "./data";

const ROW_HEIGHT = 32;
const HEADER_HEIGHT = 40;
const MIN_COL_WIDTH = 60;
const BUFFER_ROWS = 5;
const BUFFER_COLS = 3;

interface CellPos {
  row: number;
  col: number;
}

interface CanvasTableProps {
  data: DataStore;
}

export default function CanvasTable({ data }: CanvasTableProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const editInputRef = useRef<HTMLInputElement>(null);
  const scrollTopRef = useRef(0);
  const scrollLeftRef = useRef(0);
  const animFrameRef = useRef(0);

  const [selectedCell, setSelectedCell] = useState<CellPos | null>(null);
  const [editingCell, setEditingCell] = useState<CellPos | null>(null);
  const [editValue, setEditValue] = useState("");
  const [containerSize, setContainerSize] = useState({ w: 1200, h: 600 });
  const [, forceUpdate] = useState(0);

  const selectedRef = useRef(selectedCell);
  selectedRef.current = selectedCell;
  const editingRef = useRef(editingCell);
  editingRef.current = editingCell;

  // Pre-compute column offsets (they don't change)
  const colOffsets = useRef<number[]>([]);
  colOffsets.current = [];
  let cx = 40; // start after row number column
  for (let i = 0; i < data.columns.length; i++) {
    colOffsets.current.push(cx);
    cx += data.columns[i].width;
  }
  const totalWidth = cx;

  // Resize observer
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        setContainerSize({ w: Math.floor(width), h: Math.floor(height) });
      }
    });
    ro.observe(el);
    // Set initial size
    setContainerSize({
      w: Math.floor(el.clientWidth),
      h: Math.floor(el.clientHeight),
    });
    return () => ro.disconnect();
  }, []);

  // Calculate visible range
  const scrollTop = scrollTopRef.current;
  const scrollLeft = scrollLeftRef.current;
  const { w: containerWidth, h: containerHeight } = containerSize;
  const totalHeight = data.rowCount * ROW_HEIGHT + HEADER_HEIGHT;

  const startRow = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - BUFFER_ROWS);
  const endRow = Math.min(data.rowCount, Math.ceil((scrollTop + containerHeight) / ROW_HEIGHT) + BUFFER_ROWS);
  const startCol = (() => {
    let s = 0;
    for (let i = 0; i < data.columns.length; i++) {
      if (colOffsets.current[i] + data.columns[i].width > scrollLeft) { s = i; break; }
      if (i === data.columns.length - 1) s = i;
    }
    return Math.max(0, s - BUFFER_COLS);
  })();
  const endCol = (() => {
    let e = data.columns.length - 1;
    for (let i = startCol; i < data.columns.length; i++) {
      if (colOffsets.current[i] > scrollLeft + containerWidth) { e = i - 1; break; }
    }
    return Math.min(data.columns.length - 1, e + BUFFER_COLS) + 1;
  })();

  // ====== RENDER ======
  const render = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const st = scrollTopRef.current;
    const sl = scrollLeftRef.current;

    const dpr = window.devicePixelRatio || 1;
    const cw = containerSize.w;
    const ch = containerSize.h;
    if (canvas.width !== cw * dpr || canvas.height !== ch * dpr) {
      canvas.width = cw * dpr;
      canvas.height = ch * dpr;
      canvas.style.width = `${cw}px`;
      canvas.style.height = `${ch}px`;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Clear
    ctx.fillStyle = "#f8f9fa";
    ctx.fillRect(0, 0, cw, ch);

    ctx.save();
    // Translate so we draw at viewport coordinates
    // (header is fixed at top, row numbers fixed at left)

    // ===== COLUMN HEADERS (fixed at top) =====
    ctx.fillStyle = "#e9ecef";
    ctx.fillRect(0, 0, cw, HEADER_HEIGHT);

    for (let i = startCol; i < endCol; i++) {
      const col = data.columns[i];
      const x = colOffsets.current[i] - sl;
      const w = col.width;
      if (x + w < 0 || x > cw) continue;
      ctx.fillStyle = "#e9ecef";
      ctx.fillRect(x, 0, w, HEADER_HEIGHT);
      ctx.strokeStyle = "#dee2e6";
      ctx.lineWidth = 1;
      ctx.strokeRect(x, 0, w, HEADER_HEIGHT);
      ctx.fillStyle = "#495057";
      ctx.font = "bold 13px -apple-system, sans-serif";
      ctx.textBaseline = "middle";
      ctx.fillText(col.name, x + 8, HEADER_HEIGHT / 2);
    }

    // Row number header
    ctx.fillStyle = "#ced4da";
    ctx.fillRect(0, 0, 40, HEADER_HEIGHT);
    ctx.strokeStyle = "#dee2e6";
    ctx.strokeRect(0, 0, 40, HEADER_HEIGHT);
    ctx.fillStyle = "#495057";
    ctx.fillText("#", 20, HEADER_HEIGHT / 2);

    // ===== ROWS =====
    ctx.font = "13px -apple-system, sans-serif";
    ctx.textBaseline = "middle";

    for (let r = startRow; r < endRow; r++) {
      const y = HEADER_HEIGHT + (r - startRow) * ROW_HEIGHT - (st % ROW_HEIGHT);
      if (y + ROW_HEIGHT < HEADER_HEIGHT || y > ch) continue;

      // Row number cell
      ctx.fillStyle = "#f1f3f5";
      ctx.fillRect(0, y, 40, ROW_HEIGHT);
      ctx.strokeStyle = "#e9ecef";
      ctx.lineWidth = 0.5;
      ctx.strokeRect(0, y, 40, ROW_HEIGHT);
      ctx.fillStyle = "#868e96";
      ctx.textAlign = "center";
      ctx.fillText(String(r + 1), 20, y + ROW_HEIGHT / 2);
      ctx.textAlign = "start";

      // Cells
      for (let c = startCol; c < endCol; c++) {
        const col = data.columns[c];
        const x = colOffsets.current[c] - sl;
        const w = col.width;
        if (x + w < 0 || x > cw) continue;

        const cellY = y;
        const sel = selectedRef.current;
        const edt = editingRef.current;
        const isSelected = sel?.row === r && sel?.col === c;
        const isEditing = edt?.row === r && edt?.col === c;

        // Background
        if (isSelected) {
          ctx.fillStyle = "#e7f5ff";
        } else if (r % 2 === 0) {
          ctx.fillStyle = "#ffffff";
        } else {
          ctx.fillStyle = "#fafbfc";
        }
        ctx.fillRect(x, cellY, w, ROW_HEIGHT);

        // Grid line
        ctx.strokeStyle = "#e9ecef";
        ctx.lineWidth = 0.5;
        ctx.strokeRect(x, cellY, w, ROW_HEIGHT);

        // Value (skip if editing)
        if (!isEditing) {
          const value = data.getCell(r, c);
          const maxTextWidth = w - 16;
          ctx.fillStyle = "#212529";

          const metrics = ctx.measureText(value);
          if (metrics.width > maxTextWidth) {
            let truncated = value;
            while (ctx.measureText(truncated + "...").width > maxTextWidth && truncated.length > 0) {
              truncated = truncated.slice(0, -1);
            }
            ctx.fillText(truncated + "...", x + 8, cellY + ROW_HEIGHT / 2);
          } else {
            ctx.fillText(value, x + 8, cellY + ROW_HEIGHT / 2);
          }
        }
      }
    }

    // Selection border
    const sel = selectedRef.current;
    const edt = editingRef.current;
    if (sel && !edt) {
      const r = sel.row;
      const c = sel.col;
      if (r >= startRow && r < endRow && c >= startCol && c < endCol) {
        const y = HEADER_HEIGHT + (r - startRow) * ROW_HEIGHT - (st % ROW_HEIGHT);
        const x = colOffsets.current[c] - sl;
        ctx.strokeStyle = "#4c6ef5";
        ctx.lineWidth = 2;
        ctx.strokeRect(x + 1, y + 1, data.columns[c].width - 2, ROW_HEIGHT - 2);
      }
    }

    ctx.restore();
  }, [data, containerSize, startRow, endRow, startCol, endCol]);

  // Scroll handler - uses rAF and refs to avoid React re-renders during scroll
  const handleScroll = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    scrollTopRef.current = el.scrollTop;
    scrollLeftRef.current = el.scrollLeft;

    if (animFrameRef.current === 0) {
      animFrameRef.current = requestAnimationFrame(() => {
        animFrameRef.current = 0;
        render();
        // Sync React state for edit overlay position
        forceUpdate((n) => n + 1);
      });
    }
  }, [render]);

  // Re-render when data or container size changes
  useEffect(() => {
    render();
  }, [render]);

  // Handle cell click
  const handleCanvasClick = useCallback(
    (e: React.MouseEvent) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left + scrollLeftRef.current;
      const y = e.clientY - rect.top + scrollTopRef.current;

      if (y < HEADER_HEIGHT) return;

      const row = Math.floor((y - HEADER_HEIGHT + (scrollTopRef.current % ROW_HEIGHT)) / ROW_HEIGHT);
      if (row < 0 || row >= data.rowCount) return;

      const row_actual = startRow + Math.floor((y - HEADER_HEIGHT) / ROW_HEIGHT);
      // Actually, the row calculation needs to account for the virtual scroll offset
      const adjustedY = y - (scrollTopRef.current % ROW_HEIGHT);
      const displayRow = Math.floor((adjustedY - HEADER_HEIGHT) / ROW_HEIGHT);
      const realRow = startRow + displayRow;

      if (realRow < 0 || realRow >= data.rowCount) return;

      let col = -1;
      for (let i = 0; i < data.columns.length; i++) {
        const cx = colOffsets.current[i] - scrollLeftRef.current;
        if (x >= colOffsets.current[i] && x < colOffsets.current[i] + data.columns[i].width) {
          col = i;
          break;
        }
      }

      if (col >= 0) {
        setSelectedCell({ row: realRow, col });
        setEditingCell(null);
        render();
      }
    },
    [data, startRow, render]
  );

  // Handle double click - start editing
  const handleCanvasDoubleClick = useCallback(() => {
    const sel = selectedRef.current;
    if (sel) {
      setEditingCell(sel);
      setEditValue(data.getCell(sel.row, sel.col));
      render();
    }
  }, [data, render]);

  // Handle edit completion
  const commitEdit = useCallback(() => {
    const edt = editingRef.current;
    if (edt) {
      data.setCell(edt.row, edt.col, editValue);
      setEditingCell(null);
      setEditValue("");
      render();
    }
  }, [editValue, data, render]);

  // Wait for next frame after commit to auto-focus
  useEffect(() => {
    if (editingCell && editInputRef.current) {
      requestAnimationFrame(() => editInputRef.current?.focus());
    }
  }, [editingCell?.row, editingCell?.col]); // eslint-disable-line

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (editingRef.current) {
        if (e.key === "Enter") {
          e.preventDefault();
          commitEdit();
        } else if (e.key === "Escape") {
          setEditingCell(null);
          setEditValue("");
          render();
        } else if (e.key === "Tab") {
          e.preventDefault();
          commitEdit();
          const edt = editingRef.current;
          if (edt) {
            const nextCol = edt.col < data.columns.length - 1 ? edt.col + 1 : 0;
            const nextRow = nextCol === 0 ? edt.row + 1 : edt.row;
            if (nextRow < data.rowCount) {
              setSelectedCell({ row: nextRow, col: nextCol });
              setEditingCell({ row: nextRow, col: nextCol });
              setEditValue(data.getCell(nextRow, nextCol));
            }
          }
        }
        return;
      }

      const sel = selectedRef.current;
      if (!sel) return;

      const { row, col } = sel;
      let newRow = row;
      let newCol = col;

      switch (e.key) {
        case "ArrowUp":
          e.preventDefault();
          newRow = Math.max(0, row - 1);
          break;
        case "ArrowDown":
          e.preventDefault();
          newRow = Math.min(data.rowCount - 1, row + 1);
          break;
        case "ArrowLeft":
          e.preventDefault();
          newCol = Math.max(0, col - 1);
          break;
        case "ArrowRight":
          e.preventDefault();
          newCol = Math.min(data.columns.length - 1, col + 1);
          break;
        case "Enter":
          e.preventDefault();
          setEditingCell(sel);
          setEditValue(data.getCell(row, col));
          render();
          return;
        case "Delete":
        case "Backspace":
          data.setCell(row, col, "");
          render();
          return;
      }

      if (newRow !== row || newCol !== col) {
        setSelectedCell({ row: newRow, col: newCol });
        // Auto-scroll to keep selection visible
        const el = containerRef.current;
        if (el) {
          const selTop = newRow * ROW_HEIGHT;
          const selLeft = colOffsets.current[newCol];
          if (selTop < el.scrollTop + HEADER_HEIGHT) {
            el.scrollTop = Math.max(0, selTop - ROW_HEIGHT);
          } else if (selTop + ROW_HEIGHT > el.scrollTop + el.clientHeight) {
            el.scrollTop = selTop + ROW_HEIGHT - el.clientHeight;
          }
          if (selLeft < el.scrollLeft) {
            el.scrollLeft = Math.max(0, selLeft - 50);
          } else if (selLeft + data.columns[newCol].width > el.scrollLeft + el.clientWidth) {
            el.scrollLeft = selLeft + data.columns[newCol].width - el.clientWidth + 50;
          }
        }
        render();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [data, render, commitEdit]);

  // Get edit input position
  const getEditInputStyle = (): React.CSSProperties | undefined => {
    const edt = editingRef.current;
    if (!edt) return undefined;
    const col = data.columns[edt.col];
    const x = colOffsets.current[edt.col];
    return {
      position: "absolute",
      left: `${x - scrollLeftRef.current}px`,
      top: `${HEADER_HEIGHT + edt.row * ROW_HEIGHT - scrollTopRef.current}px`,
      width: `${col.width}px`,
      height: `${ROW_HEIGHT}px`,
      zIndex: 10,
    };
  };

  return (
    <div
      ref={containerRef}
      onScroll={handleScroll}
      style={{
        width: "100%",
        height: "100%",
        overflow: "auto",
        position: "relative",
      }}
    >
      {/* Scroll gutter */}
      <div style={{ width: totalWidth, height: totalHeight, position: "relative" }}>
        <canvas
          ref={canvasRef}
          onClick={handleCanvasClick}
          onDoubleClick={handleCanvasDoubleClick}
          style={{
            position: "sticky",
            top: 0,
            left: 0,
            cursor: "cell",
          }}
        />
      </div>

      {/* Edit overlay */}
      {editingCell && (
        <div style={getEditInputStyle()}>
          <input
            ref={editInputRef}
            type="text"
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onBlur={commitEdit}
            style={{
              width: "100%",
              height: "100%",
              border: "2px solid #4c6ef5",
              outline: "none",
              padding: "0 8px",
              fontSize: "13px",
              fontFamily: "-apple-system, sans-serif",
              boxSizing: "border-box",
              background: "#fff",
            }}
          />
        </div>
      )}
    </div>
  );
}
