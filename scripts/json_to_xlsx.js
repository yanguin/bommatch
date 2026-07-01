// 从 viyong_products_full.json 生成完整 xlsx (含容量偏差/额定电压/规格书)
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');

const INPUT_JSON = path.join(__dirname, 'viiyong_products_full.json');
const OUTPUT_XLSX = path.join(__dirname, 'viiyong_products_full.xlsx');

// 表头
const HEADERS = [
  '品名',
  '产品特点',
  '应用场景',
  '尺寸(Inch/mm)',
  '长度(mm)',
  '宽度(mm)',
  '厚度(mm)',
  '温度特性',
  '标称容量',
  '容量偏差',
  '额定电压(Vdc)',
  '规格书',
];

// 清洗 features 字段的 HTML, 提取纯文本并用顿号分隔
function cleanFeatures(html) {
  if (!html) return '';
  return html
    .replace(/<\/span>/gi, '、')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/[、\s]+/g, '、')
    .replace(/^、|、$/g, '')
    .trim();
}

function rowFromItem(item) {
  // 拼接规格书完整URL
  let specsUrl = '';
  if (item.specs && item.specs.length > 0 && item.specs[0].FileUrl) {
    specsUrl = 'https://www.viiyong.com' + item.specs[0].FileUrl;
  }
  return [
    item.productName || '',
    cleanFeatures(item.features),
    item.application || '',
    item.size || '',
    item.length || '',
    item.width || '',
    item.thickness || '',
    item.tempCharacteristics || '',
    item.capacity || '',
    item.capacityDeviation || '',
    item.voltage || '',
    specsUrl,
  ];
}

function main() {
  console.log('读取:', INPUT_JSON);
  const raw = fs.readFileSync(INPUT_JSON, 'utf8');
  const data = JSON.parse(raw);
  const list = data.list || [];
  console.log(`共 ${list.length} 条数据`);

  const rows = list.map(rowFromItem);
  const aoa = [HEADERS, ...rows];

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  // 设置列宽
  ws['!cols'] = [
    { wch: 24 }, // 品名
    { wch: 28 }, // 产品特点
    { wch: 14 }, // 应用场景
    { wch: 16 }, // 尺寸
    { wch: 14 }, // 长度
    { wch: 14 }, // 宽度
    { wch: 14 }, // 厚度
    { wch: 22 }, // 温度特性
    { wch: 12 }, // 标称容量
    { wch: 12 }, // 容量偏差
    { wch: 14 }, // 额定电压(Vdc)
    { wch: 48 }, // 规格书
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '产品列表');
  XLSX.writeFile(wb, OUTPUT_XLSX);

  console.log(`完成! xlsx: ${OUTPUT_XLSX}`);
}

try {
  main();
} catch (e) {
  console.error('转换失败:', e);
  process.exit(1);
}