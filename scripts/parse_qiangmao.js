// 解析强茂 xls 文件为 JSON
const XLSX = require('xlsx');
const path = require('path');
const fs = require('fs');

const filePath = path.join(__dirname, '..', 'data', '强茂_604.xls');
const wb = XLSX.readFile(filePath);
const ws = wb.Sheets['Worksheet'];
const rows = XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: false, defval: null });

// 构建字段名（合并表头行3和单位行4）
const headerRow = rows[3];
const unitRow = rows[4];

// 字段名映射（英文列名 → JSON字段名）
function buildFieldName(header, unit, colIdx) {
  const h = (header || '').trim();
  const u = (unit || '').toString().trim();
  // RDS(on) 多列，用单位区分
  if (h === 'RDS(on) Max. (mΩ)') {
    return 'rdsOn_' + u.replace('.', '_');
  }
  // Qg 多列
  if (h === 'Qg Typ. (nC)') {
    return 'qg_' + u.replace('.', '_');
  }
  return null; // 其他用默认映射
}

// 列索引到字段名映射
const fieldNames = [
  'partNumber',    // 0: Part Number
  'package',       // 1: Package
  'productStatus', // 2: Product Status
  'replacementPart',// 3: Replacement Part
  'aecQ101',       // 4: AEC-Q101 Qualified
  'esd',           // 5: ESD
  'polarity',      // 6: Polarity
  'config',        // 7: Config.
  'vds',           // 8: VDS (V)
  'vgs',           // 9: VGS (±V)
  'id',            // 10: ID (A)
  'rdsOn_10V',     // 11: RDS(on) @10V
  'rdsOn_7V',      // 12: RDS(on) @7V
  'rdsOn_6V',      // 13: RDS(on) @6V
  'rdsOn_4_5V',    // 14: RDS(on) @4.5V
  'rdsOn_2_5V',    // 15: RDS(on) @2.5V
  'rdsOn_1_8V',    // 16: RDS(on) @1.8V
  'rdsOn_1_5V',    // 17: RDS(on) @1.5V
  'rdsOn_1_2V',    // 18: RDS(on) @1.2V
  'ciss',          // 19: Ciss Typ. (pF)
  'vgsTh',         // 20: VGS(th) Max. (V)
  'qg_10V',        // 21: Qg @10V
  'qg_4_5V'        // 22: Qg @4.5V
];

// 解析数据行（从行5开始）
const list = [];
for (let i = 5; i < rows.length; i++) {
  const row = rows[i];
  if (!row || !row[0]) continue;

  const item = {};
  for (let j = 0; j < fieldNames.length; j++) {
    const val = row[j];
    // "-" 视为空值
    if (val === '-' || val === null || val === undefined) {
      item[fieldNames[j]] = '';
    } else {
      item[fieldNames[j]] = typeof val === 'number' ? val : String(val).trim();
    }
  }

  // 提取超链接（A列）
  const cellAddr = 'A' + (i + 1); // Excel 行号从1开始
  const cell = ws[cellAddr];
  if (cell && cell.l && cell.l.Target) {
    item.specUrl = cell.l.Target;
  } else {
    // 如果没有超链接，根据 partNumber 构造
    const pn = String(item.partNumber || '').trim();
    if (pn) {
      item.specUrl = 'https://www.panjit.com.tw/cn/Product/downloadPDF/' + pn;
    } else {
      item.specUrl = '';
    }
  }

  list.push(item);
}

const result = {
  total: list.length,
  brand: 'panjit',
  source: '强茂_604.xls',
  fields: fieldNames,
  list: list
};

const outputPath = path.join(__dirname, '..', 'data', 'qiangmao_products.json');
fs.writeFileSync(outputPath, JSON.stringify(result, null, 2), 'utf8');

console.log('解析完成！');
console.log('产品数量:', list.length);
console.log('输出文件:', outputPath);
console.log('\n前3条示例:');
for (let i = 0; i < Math.min(3, list.length); i++) {
  console.log(JSON.stringify(list[i], null, 2));
}
