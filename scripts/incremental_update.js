// 增量更新微容产品数据
// 功能: 拉取官网最新数据, 与本地 JSON 对比, 只追加新增型号(不重复)
// 用法: node scripts/incremental_update.js
const fs = require('fs');
const https = require('https');
const path = require('path');

const API_URL = 'https://www.viiyong.com/Ajax/product.ashx';
const PAGE_SIZE = 100;
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1500;
const PAGE_DELAY_MS = 300;

const REQUEST_TEMPLATE_PATH = path.join(__dirname, '传出.txt');
const OUTPUT_JSON = path.join(__dirname, '..', 'data', 'viiyong_products_full.json');

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
      const data = await postPage(buildRequestBody(template, pageIndex));
      if (data.status !== 1) {
        throw new Error('接口返回 status=' + data.status);
      }
      return data;
    } catch (e) {
      lastErr = e;
      console.error(`  [第${pageIndex}页 第${a}次失败] ${e.message}`);
      if (a < MAX_RETRIES) await sleep(RETRY_DELAY_MS * a);
    }
  }
  throw lastErr;
}

async function main() {
  console.log('===== 微容产品数据增量更新 =====');
  console.log('');

  // 1. 加载本地数据
  let localData = { total: 0, list: [] };
  let localProductNames = new Set();

  if (fs.existsSync(OUTPUT_JSON)) {
    localData = JSON.parse(fs.readFileSync(OUTPUT_JSON, 'utf8'));
    for (const item of localData.list) {
      if (item.productName) localProductNames.add(item.productName);
    }
    console.log('本地数据:', localData.list.length, '条');
  } else {
    console.log('本地数据: 无');
  }

  // 2. 拉取官网最新数据
  const template = JSON.parse(fs.readFileSync(REQUEST_TEMPLATE_PATH, 'utf8'));
  console.log('拉取官网数据...');

  const first = await fetchPageWithRetry(template, 1);
  const remoteTotal = first.data.totle;
  const remoteList = (first.data.list || []).slice();
  console.log(`官网总数: ${remoteTotal}, 共 ${Math.ceil(remoteTotal / PAGE_SIZE)} 页`);

  const totalPages = Math.ceil(remoteTotal / PAGE_SIZE);
  for (let p = 2; p <= totalPages; p++) {
    const d = await fetchPageWithRetry(template, p);
    remoteList.push(...(d.data.list || []));
    if (p % 10 === 0) console.log(`  第${p}/${totalPages}页, 累计 ${remoteList.length}`);
    if (p < totalPages) await sleep(PAGE_DELAY_MS);
  }

  console.log('官网数据拉取完成:', remoteList.length, '条');
  console.log('');

  // 3. 对比找出新增型号
  const newItems = [];
  for (const item of remoteList) {
    if (item.productName && !localProductNames.has(item.productName)) {
      newItems.push(item);
    }
  }

  console.log('===== 对比结果 =====');
  console.log('本地已有:', localData.list.length, '条');
  console.log('官网最新:', remoteList.length, '条');
  console.log('新增型号:', newItems.length, '条');

  if (newItems.length === 0) {
    console.log('');
    console.log('无新增型号，本地数据已是最新。');
    return;
  }

  // 4. 显示新增型号列表
  console.log('');
  console.log('新增型号列表:');
  for (const item of newItems) {
    console.log(`  ${item.productName} | ${item.size || ''} | ${item.capacity || ''} | ${item.voltage || ''}V`);
  }

  // 5. 合并并保存
  const mergedList = [...localData.list, ...newItems];
  const mergedData = {
    total: mergedList.length,
    list: mergedList
  };

  // 备份原文件
  if (fs.existsSync(OUTPUT_JSON)) {
    const backupPath = OUTPUT_JSON + '.bak';
    fs.copyFileSync(OUTPUT_JSON, backupPath);
    console.log('');
    console.log('已备份原文件到:', backupPath);
  }

  fs.writeFileSync(OUTPUT_JSON, JSON.stringify(mergedData));
  console.log('');
  console.log('===== 更新完成 =====');
  console.log('合并后总数:', mergedList.length, '条');
  console.log('保存到:', OUTPUT_JSON);
}

main().catch((e) => {
  console.error('失败:', e);
  process.exit(1);
});