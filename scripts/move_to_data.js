const fs = require('fs');
const path = require('path');

const dataDir = path.join(__dirname, '..', 'data');
const scriptsDir = __dirname;

console.log('========== 移动新数据到 data 目录 ==========');

const filesToMove = [
  'viiyong_products_full.json',
  'viiyong_products_full.xlsx'
];

filesToMove.forEach(file => {
  const src = path.join(scriptsDir, file);
  const dest = path.join(dataDir, file);
  if (fs.existsSync(src)) {
    fs.renameSync(src, dest);
    console.log(`移动: scripts/${file} -> data/${file}`);
  } else {
    console.log(`跳过: ${file} (不存在)`);
  }
});

console.log('移动完成');