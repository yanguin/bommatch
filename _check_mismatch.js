// 详细检查行对应关系
const XLSX = require('xlsx');
const path = require('path');

const filePath = path.join(__dirname, 'data', '强茂_604.xls');
const wb = XLSX.readFile(filePath);
const ws = wb.Sheets['Worksheet'];
const rows = XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: false, defval: null });

console.log('检查 rows 数组和超链接的对应关系:');
console.log('rows.length:', rows.length);

// 检查 rows[21] (Excel row 22)
console.log('\nrows[21] (Excel row 22):');
console.log('  rows[21][0]:', rows[21] && rows[21][0]);

// 检查 A22 单元格
const cellA22 = ws['A22'];
console.log('\nws[A22]:');
console.log('  .v:', cellA22 && cellA22.v);
console.log('  .l:', cellA22 && cellA22.l);

// 找 PSMQE096N10LS2 在 rows 数组的哪一行
console.log('\n找 PSMQE096N10LS2 在 rows 数组的位置:');
for (let i = 0; i < rows.length; i++) {
  if (rows[i] && rows[i][0] && String(rows[i][0]).trim() === 'PSMQE096N10LS2') {
    console.log('  找到: rows[' + i + '] (Excel row ' + (i+1) + ')');
    const cellAddr = 'A' + (i + 1);
    const cell = ws[cellAddr];
    console.log('  单元格值:', cell && cell.v);
    console.log('  超链接:', cell && cell.l);
    break;
  }
}

// 检查第 1 条数据 (PJQ5588) 的对应关系
console.log('\n检查第 1 条数据 PJQ5588:');
console.log('  rows[5][0]:', rows[5] && rows[5][0]);
const cellA6 = ws['A6'];
console.log('  ws[A6].v:', cellA6 && cellA6.v);
console.log('  ws[A6].l:', cellA6 && cellA6.l);

// 统计有多少行的单元格值和超链接不一致
console.log('\n统计不一致的行数:');
let mismatchCount = 0;
const mismatches = [];
for (let i = 5; i < rows.length; i++) {
  const rowVal = rows[i] && rows[i][0] ? String(rows[i][0]).trim() : '';
  const cellAddr = 'A' + (i + 1);
  const cell = ws[cellAddr];
  const cellVal = cell && cell.v ? String(cell.v).trim() : '';
  const linkVal = cell && cell.l ? cell.l.Target : '';
  
  if (rowVal !== cellVal) {
    mismatchCount++;
    if (mismatches.length < 10) {
      mismatches.push({
        rowIndex: i,
        excelRow: i + 1,
        rowVal,
        cellVal,
        linkVal
      });
    }
  }
}
console.log('不一致行数:', mismatchCount);
console.log('\n前10个不一致示例:');
for (const m of mismatches) {
  console.log(`  rows[${m.rowIndex}]="${m.rowVal}" vs A${m.excelRow}.v="${m.cellVal}" link="${m.linkVal}"`);
}