// 验证偏移量
const XLSX = require('xlsx');
const path = require('path');

const filePath = path.join(__dirname, 'data', '强茂_604.xls');
const wb = XLSX.readFile(filePath);
const ws = wb.Sheets['Worksheet'];
const rows = XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: false, defval: null });

console.log('验证偏移规律:');
// 假设偏移是 +4: rows[i] 对应 ws['A' + (i + 4)]
// 检查前 10 条数据
for (let i = 5; i <= 14; i++) {
  const rowVal = rows[i] && rows[i][0] ? String(rows[i][0]).trim() : '';
  const cellAddr = 'A' + (i + 4);
  const cell = ws[cellAddr];
  const cellVal = cell && cell.v ? String(cell.v).trim() : '';
  const linkVal = cell && cell.l ? cell.l.Target.split('/').pop() : '';
  
  console.log(`rows[${i}]="${rowVal}" → A${i+4}.v="${cellVal}" link="${linkVal}" match=${rowVal === cellVal}`);
}

// 检查 PSMQE096N10LS2
console.log('\n检查 PSMQE096N10LS2:');
for (let i = 5; i < rows.length; i++) {
  if (rows[i] && rows[i][0] && String(rows[i][0]).trim() === 'PSMQE096N10LS2') {
    console.log('找到: rows[' + i + '] =', rows[i][0]);
    const cellAddr = 'A' + (i + 4);
    const cell = ws[cellAddr];
    console.log('ws[' + cellAddr + '].v =', cell && cell.v);
    console.log('ws[' + cellAddr + '].l =', cell && cell.l && cell.l.Target);
    break;
  }
}