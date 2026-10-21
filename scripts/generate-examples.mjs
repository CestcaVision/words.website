import ExcelJS from "exceljs";
import { parse } from "csv-parse/sync";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
const csv = new URL(
  "../apps/web/public/examples/vocabulary.csv",
  import.meta.url,
);
const rows = parse(readFileSync(csv, "utf8"));
const book = new ExcelJS.Workbook();
const sheet = book.addWorksheet("Vocabulary");
rows.forEach((row) => sheet.addRow(row));
sheet.columns.forEach((c) => (c.width = 24));
sheet.getRow(1).font = { bold: true };
await book.xlsx.writeFile(
  fileURLToPath(
    new URL("../apps/web/public/examples/vocabulary.xlsx", import.meta.url),
  ),
);
writeFileSync(
  new URL("../apps/web/public/examples/vocabulary.txt", import.meta.url),
  rows
    .slice(1)
    .map((row) => row[0])
    .join("\n") + "\n",
);
console.log("原创示例 Excel / TXT 已生成。");
