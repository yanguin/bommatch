// 检查特定型号的超链接
const XLSX = require('xlsx');
const path = require('path');

const filePath = path.join(__dirname, 'data', '强茂_604.xls');
const wb = XLSX.readFile(filePath);
const ws = wb.Sheets['Worksheet'];
const rows = XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: false, defval: null });

// 找 PSMQE096N10LS2 的行号
for (let i = 5; i < rows.length; i++) {
  const row = rows[i];
  if (row[0] && String(row[0]).trim() === 'PSMQE096N10LS2') {
    console.log('找到型号在行', i + 1);
    const cellAddr = 'A' + (i + 1);
    const cell = ws[cellAddr];
    console.log('单元格值:', cell && cell.v);
    console.log('超链接:', cell && cell.l);
    
    // 检查附近几行
    console.log('\n附近5行的超链接:');
    for (let j = i - 2; j <= i + 2; j++) {
      const addr = 'A' + (j + 1);
      const c = ws[addr];
      if (c && c.l) {
        console.log(`行${j+1}: 值="${c.v}", 链接="${c.l.Target}"`);
      }
    }
    break;
  }
}

// 再检查一下产品 JSON 里对应的数据
const data = require('./data/qiangmao_products.json');
for (const item of data.list) {
  if (item.partNumber === 'PSMQE096N10LS2') {
    console.log('\nJSON 里的数据:');
    console.log('partNumber:', item.partNumber);
    console.log('specUrl:', item.specUrl);
    break;
  }
}