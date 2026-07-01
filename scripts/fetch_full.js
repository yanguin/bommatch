// 重新拉取全量产品数据(含所有字段: 电压/容量偏差等), 保存为 viiyong_products_full.json
// 供 BOM 匹配使用. 若已存在则跳过拉取.
const fs = require('fs');
const https = require('https');
const path = require('path');

const API_URL = 'https://www.viiyong.com/Ajax/product.ashx';
const PAGE_SIZE = 100;
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1500;
const PAGE_DELAY_MS = 300;

const REQUEST_TEMPLATE_PATH = path.join(__dirname, '传出.txt');
const OUTPUT_JSON = path.join(__dirname, 'viiyong_products_full.json');

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function buildRequestBody(template, pageIndex) {
  const obj = JSON.parse(JSON.stringify(template));
  obj.pageIndex = pageIndex;
  obj.pageSize = String(PAGE_SIZE);
  return JSON.stringify(obj);
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
        Accept: 'application/json, text/javascript, */*; q=0.01',
        'Accept-Language': 'zh-CN,zh;q=0.9',
        Origin: 'https://www.viiyong.com',
        Referer: 'https://www.viiyong.com/cn/Product.aspx',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'X-Requested-With': 'XMLHttpRequest',
      },
    };
    const req = https.request(options, (res) => {
      let chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        if (res.statusCode !== 200) return reject(new Error('HTTP ' + res.statusCode));
        try {
          resolve(JSON.parse(raw));
        } catch (e) {
          reject(new Error('JSON 解析失败'));
        }
      });
    });
    req.on('error', reject);
    req.setTimeout(30000, () => req.destroy(new Error('请求超时')));
    req.write(payload);
    req.end();
  });
}

async function fetchPageWithRetry(template, pageIndex) {
  let lastErr;
  for (let a = 1; a <= MAX_RETRIES; a++) {
    try {
      return await postPage(buildRequestBody(template, pageIndex));
    } catch (e) {
      lastErr = e;
      console.error(`  [第${pageIndex}页 第${a}次失败] ${e.message}`);
      if (a < MAX_RETRIES) await sleep(RETRY_DELAY_MS * a);
    }
  }
  throw lastErr;
}

async function main() {
  if (fs.existsSync(OUTPUT_JSON)) {
    const old = JSON.parse(fs.readFileSync(OUTPUT_JSON, 'utf8'));
    if (old && old.total && old.list && old.list.length >= old.total) {
      console.log(`已存在完整数据 ${old.list.length}/${old.total}, 跳过拉取.`);
      return;
    }
  }
  const template = JSON.parse(fs.readFileSync(REQUEST_TEMPLATE_PATH, 'utf8'));
  const first = await fetchPageWithRetry(template, 1);
  const total = first.data.totle;
  const all = (first.data.list || []).slice();
  console.log(`总数 ${total}, 共 ${Math.ceil(total / PAGE_SIZE)} 页`);
  const totalPages = Math.ceil(total / PAGE_SIZE);
  for (let p = 2; p <= totalPages; p++) {
    const d = await fetchPageWithRetry(template, p);
    all.push(...(d.data.list || []));
    if (p % 20 === 0 || p === totalPages) {
      fs.writeFileSync(OUTPUT_JSON, JSON.stringify({ total, list: all }));
    }
    if (p % 10 === 0) console.log(`第${p}/${totalPages}页, 累计 ${all.length}`);
    if (p < totalPages) await sleep(PAGE_DELAY_MS);
  }
  fs.writeFileSync(OUTPUT_JSON, JSON.stringify({ total, list: all }));
  console.log(`完成, 共 ${all.length} 条 -> ${OUTPUT_JSON}`);
}

main().catch((e) => {
  console.error('失败:', e);
  process.exit(1);
});
