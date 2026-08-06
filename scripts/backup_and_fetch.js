const fs = require('fs');
const path = require('path');

const dataDir = path.join(__dirname, '..', 'data');
const scriptsDir = __dirname;

// 自动生成日期戳 (格式: YYYYMMDD)
const now = new Date();
const dateStamp = now.toISOString().slice(0, 10).replace(/-/g, '');
const archiveDir = path.join(dataDir, `archive_${dateStamp}`);

console.log('========== 步骤1: 备份旧数据 ==========');

// 创建备份文件夹
if (!fs.existsSync(archiveDir)) {
  fs.mkdirSync(archiveDir, { recursive: true });
  console.log('创建备份文件夹:', archiveDir);
} else {
  console.log('备份文件夹已存在:', archiveDir);
}

// 备份 data 目录下的旧数据
const filesToBackup = [
  'viiyong_products_full.json',
  'viiyong_products_full.xlsx'
];

filesToBackup.forEach(file => {
  const src = path.join(dataDir, file);
  const dest = path.join(archiveDir, file);
  if (fs.existsSync(src)) {
    fs.renameSync(src, dest);
    console.log(`备份: ${file} -> archive_${dateStamp}/${file}`);
  } else {
    console.log(`跳过: ${file} (不存在)`);
  }
});

console.log('备份完成\n');

// 爬取完成后,移动 scripts 下的新数据到 data 目录
function moveNewData() {
  console.log('\n========== 步骤3: 移动新数据到 data 目录 ==========');

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
}

// 导出函数供外部调用
module.exports = { moveNewData };

// 如果直接运行此脚本,只执行备份
if (require.main === module) {
  console.log('仅执行备份操作。如需完整流程,请运行 backup_and_fetch.bat');
}