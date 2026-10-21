import ExcelJS from "exceljs";
import { parse } from "csv-parse/sync";
export const fields = [
  "word",
  "zh",
  "en",
  "phonetic",
  "pos",
  "example",
  "translation",
  "tags",
  "notes",
];
export const aliases: Record<string, string> = {
  英文单词: "word",
  单词: "word",
  英文: "word",
  中文释义: "zh",
  释义: "zh",
  英文释义: "en",
  音标: "phonetic",
  词性: "pos",
  英文例句: "example",
  中文例句翻译: "translation",
  单词标签: "tags",
  标签: "tags",
  个人备注: "notes",
  备注: "notes",
};
export async function readImport(buffer: Buffer, filename: string) {
  let rows: string[][];
  if (/\.xlsx$/i.test(filename)) {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer as any);
    const sheet = wb.worksheets[0];
    if (!sheet) throw new Error("Excel 没有工作表");
    rows = [];
    sheet.eachRow({ includeEmpty: true }, (row) => {
      const values: string[] = [];
      for (let i = 1; i <= Math.min(sheet.columnCount, 30); i++)
        values.push(row.getCell(i).text);
      rows.push(values);
    });
  } else if (/\.(csv|txt)$/i.test(filename)) {
    const text = buffer.toString("utf8").replace(/^\uFEFF/, "");
    rows = parse(text, {
      relax_column_count: true,
      skip_empty_lines: false,
      delimiter: /\.txt$/i.test(filename)
        ? text.includes("\t")
          ? "\t"
          : ","
        : ",",
      bom: true,
    });
  } else throw new Error("仅支持 .xlsx、UTF-8 CSV 或 TXT");
  if (rows.length > 20001) throw new Error("单次最多导入 20000 行");
  const first = rows[0] || [];
  const hasHeader = first.some(
    (x) => fields.includes(x.trim().toLowerCase()) || aliases[x.trim()],
  );
  const headers = hasHeader
    ? first
    : first.map((_, i) => (i === 0 ? "word" : `column${i + 1}`));
  return {
    headers,
    rows: hasHeader ? rows.slice(1) : rows,
    mapping: headers.map(
      (h) =>
        aliases[h.trim()] ||
        (fields.includes(h.trim().toLowerCase()) ? h.trim().toLowerCase() : ""),
    ),
  };
}
