// 临时对比：归档旧数据 vs 本次新数据（按 productName）
const path = require('path');
const fs = require('fs');

const dir = path.join(__dirname, '..', 'data');
const oldData = JSON.parse(fs.readFileSync(path.join(dir, 'archive_20261020', 'viiyong_products_full.json'), 'utf8'));
const newData = JSON.parse(fs.readFileSync(path.join(dir, 'viiyong_products_full.json'), 'utf8'));

const oldMap = new Map(oldData.list.map(x => [x.productName, x]));
const newMap = new Map(newData.list.map(x => [x.productName, x]));

const removed = oldData.list.filter(x => !newMap.has(x.productName)).map(x => x.productName);
const added = newData.list.filter(x => !oldMap.has(x.productName)).map(x => x.productName);

console.log(`旧 ${oldData.list.length} 条, 新 ${newData.list.length} 条`);
console.log(`下架 ${removed.length} 条, 新增 ${added.length} 条`);

if (removed.length) console.log('\n--- 下架明细 ---\n' + removed.join('\n'));
if (added.length) console.log('\n--- 新增明细 ---\n' + added.join('\n'));

// 新增条目详情（含规格字段）
if (added.length) {
  console.log('\n--- 新增条目详情 ---');
  for (const name of added) {
    const item = newMap.get(name);
    const brief = {};
    for (const k of Object.keys(item)) {
      const v = String(item[k]);
      brief[k] = v.includes('<') ? v.replace(/<[^>]+>/g, '').trim() : v;
    }
    console.log(JSON.stringify(brief));
  }
}
