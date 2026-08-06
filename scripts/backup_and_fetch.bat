@echo off
cd /d "%~dp0\.."
echo ========================================
echo 步骤1: 备份旧数据
echo ========================================
node scripts\backup_and_fetch.js
echo.
echo ========================================
echo 步骤2: 爬取新数据
echo ========================================
cd scripts
node fetch_full.js
node json_to_xlsx.js
echo.
echo ========================================
echo 步骤3: 移动文件到 data 目录
echo ========================================
node move_to_data.js
cd ..
echo.
echo ========================================
echo 全部完成！
echo ========================================
pause