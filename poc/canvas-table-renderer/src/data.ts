// Seeded pseudo-random generator (mulberry32) for deterministic cell values
function mulberry32(seed: number): () => number {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const COLUMN_TYPES = [
  "text",
  "number",
  "date",
  "select",
  "email",
  "phone",
] as const;

export interface ColumnDef {
  id: string;
  name: string;
  type: string;
  width: number;
}

export interface TableData {
  columns: ColumnDef[];
  rowCount: number;
}

const FIRST_NAMES = [
  "张伟", "王芳", "李娜", "刘洋", "陈静", "杨帆", "赵敏", "黄丽",
  "周强", "吴鑫", "徐明", "孙超", "马琳", "朱峰", "胡涛", "郭宇",
  "林浩", "何雪", "高瑞", "罗婷", "Alice", "Bob", "Carol", "Dave",
];

const CITIES = ["北京", "上海", "广州", "深圳", "杭州", "成都", "武汉", "南京"];

function generateCellValue(
  row: number,
  colIndex: number,
  colType: string,
  rng: () => number
): string {
  switch (colType) {
    case "text":
      return `${FIRST_NAMES[Math.floor(rng() * FIRST_NAMES.length)]}`;
    case "number":
      return String(Math.floor(rng() * 100000));
    case "date":
      return `2024-${String(Math.floor(rng() * 12) + 1).padStart(2, "0")}-${String(
        Math.floor(rng() * 28) + 1
      ).padStart(2, "0")}`;
    case "select":
      return ["选项A", "选项B", "选项C", "选项D"][Math.floor(rng() * 4)];
    case "email":
      return `user${row}@example.com`;
    case "phone":
      return `1${String(Math.floor(rng() * 9) + 3)}${String(
        Math.floor(rng() * 1000000000)
      ).padStart(9, "0")}`;
    default:
      return "";
  }
}

export class DataStore {
  columns: ColumnDef[];
  rowCount: number;
  private modified: Map<string, string> = new Map();

  constructor(rowCount: number, colCount: number) {
    this.rowCount = rowCount;
    this.columns = Array.from({ length: colCount }, (_, i) => ({
      id: `col_${i}`,
      name: `字段${i + 1}`,
      type: COLUMN_TYPES[i % COLUMN_TYPES.length],
      width: i === 0 ? 80 : 150,
    }));
  }

  getCell(row: number, col: number): string {
    const key = `${row}:${col}`;
    if (this.modified.has(key)) return this.modified.get(key)!;

    const rng = mulberry32(row * 1000 + col);
    return generateCellValue(row, col, this.columns[col].type, rng);
  }

  setCell(row: number, col: number, value: string): void {
    this.modified.set(`${row}:${col}`, value);
  }

  private cellKeyToRowCol(key: string): [number, number] {
    const [r, c] = key.split(":").map(Number);
    return [r, c];
  }
}
