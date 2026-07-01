// 爬取 https://www.viiyong.com/cn/Product.aspx 全部产品数据并导出为 xlsx
// 接口: POST https://www.viiyong.com/Ajax/product.ashx
// 请求体模板: 传出.txt
// 爬虫逻辑: 从第1页开始, 每页100条数据, 直到没有更多数据为止
const fs = require('fs');
const https = require('https');
const path = require('path');
const XLSX = require('xlsx');

const API_URL = 'https://www.viiyong.com/Ajax/product.ashx';
const PAGE_SIZE = 100;
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1500;
const PAGE_DELAY_MS = 300; // 每页之间的礼貌延时

const REQUEST_TEMPLATE_PATH = path.join(__dirname, '传出.txt');
const OUTPUT_XLSX = path.join(__dirname, 'viiyong_products.xlsx');
const OUTPUT_JSON = path.join(__dirname, 'viiyong_products.json');

// 表头: 品名, 产品特点, 应用场景, 尺寸(Inch/mm), 长度(mm), 宽度(mm), 厚度(mm), 温度特性, 标称容量, 容量偏差, 额定电压(Vdc), 规格书
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

function buildRequestBody(template, pageIndex) {
  const obj = JSON.parse(JSON.stringify(template));
  obj.pageIndex = pageIndex;
  obj.pageSize = String(PAGE_SIZE);
  return JSON.stringify(obj);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function postPage(bodyStr) {
  return new Promise((resolve, reject) => {
    const url = new URL(API_URL);
    const payload = Buffer.from(bodyStr, 'utf8');
    const options = {
      hostname: url.hostname,
      path: url.pathname + url.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=UTF-8',
        'Content-Length': payload.length,
        'Accept': 'application/json, text/javascript, */*; q=0.01',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        'Origin': 'https://www.viiyong.com',
        'Referer': 'https://www.viiyong.com/cn/Product.aspx',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'X-Requested-With': 'XMLHttpRequest',
      },
    };
    const req = https.request(options, (res) => {
      let chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        if (res.statusCode !== 200) {
          return reject(new Error(`HTTP ${res.statusCode}: ${raw.slice(0, 200)}`));
        }
        try {
          resolve(JSON.parse(raw));
        } catch (e) {
          reject(new Error('JSON 解析失败: ' + raw.slice(0, 200)));
        }
      });
    });
    req.on('error', reject);
    req.setTimeout(30000, () => {
      req.destroy(new Error('请求超时'));
    });
    req.write(payload);
    req.end();
  });
}

async function fetchPageWithRetry(template, pageIndex) {
  let lastErr;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const bodyStr = buildRequestBody(template, pageIndex);
      const data = await postPage(bodyStr);
      if (data.status !== 1) {
        throw new Error('接口返回 status=' + data.status + ' message=' + (data.message || ''));
      }
      return data;
    } catch (e) {
      lastErr = e;
      console.error(`  [第${pageIndex}页 第${attempt}次失败] ${e.message}`);
      if (attempt < MAX_RETRIES) await sleep(RETRY_DELAY_MS * attempt);
    }
  }
  throw lastErr;
}

function rowFromItem(item) {
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
  ];
}

async function main() {
  const templateRaw = fs.readFileSync(REQUEST_TEMPLATE_PATH, 'utf8');
  const template = JSON.parse(templateRaw);
  console.log('请求模板加载完成, pageSize=', template.pageSize);

  // 先请求第1页拿到总数
  const first = await fetchPageWithRetry(template, 1);
  const total = first.data.totle;
  const firstList = first.data.list || [];
  console.log(`总数: ${total}, 每页 ${PAGE_SIZE}, 共需 ${Math.ceil(total / PAGE_SIZE)} 页`);

  const allRows = [];
  for (const item of firstList) allRows.push(rowFromItem(item));
  console.log(`第1页完成, 累计 ${allRows.length} 条`);

  const totalPages = Math.ceil(total / PAGE_SIZE);
  for (let page = 2; page <= totalPages; page++) {
    const data = await fetchPageWithRetry(template, page);
    const list = data.data.list || [];
    for (const item of list) allRows.push(rowFromItem(item));
    console.log(`第${page}/${totalPages}页完成, 本页 ${list.length} 条, 累计 ${allRows.length}/${total}`);
    // 每抓 20 页落盘一次 JSON 备份, 防止意外中断丢失数据
    if (page % 20 === 0 || page === totalPages) {
      fs.writeFileSync(OUTPUT_JSON, JSON.stringify({ total, rows: allRows }, null, 2));
    }
    if (page < totalPages) await sleep(PAGE_DELAY_MS);
  }

  // 写 xlsx
  const aoa = [HEADERS, ...allRows];
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
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '产品列表');
  XLSX.writeFile(wb, OUTPUT_XLSX);

  console.log(`\n完成! 共 ${allRows.length} 条`);
  console.log(`xlsx: ${OUTPUT_XLSX}`);
  console.log(`json备份: ${OUTPUT_JSON}`);
}

main().catch((e) => {
  console.error('爬取失败:', e);
  process.exit(1);
});
