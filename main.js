const { app, BrowserWindow, ipcMain, dialog, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const XLSX = require('xlsx');

let mainWindow;

function createWindow() {
  // 隐藏菜单栏
  Menu.setApplicationMenu(null);

  mainWindow = new BrowserWindow({
    width: 1000,
    height: 650,
    minWidth: 900,
    minHeight: 500,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      enableRemoteModule: true
    },
    icon: path.join(__dirname, 'build/icon.ico')
  });

  mainWindow.loadFile('index.html');

  // 开发模式下打开开发者工具
  if (process.argv.includes('--dev')) {
    mainWindow.webContents.openDevTools();
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

// ========== IPC 处理 ==========

// 选择文件
ipcMain.handle('select-file', async (event, filters) => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: filters || [{ name: 'Excel文件', extensions: ['xlsx', 'xls'] }]
  });
  return result.filePaths;
});

// 保存文件
ipcMain.handle('save-file', async (event, defaultName) => {
  const result = await dialog.showSaveDialog(mainWindow, {
    defaultPath: defaultName,
    filters: [{ name: 'Excel文件', extensions: ['xlsx'] }]
  });
  return result.filePath;
});

// 加载viiyong产品数据
ipcMain.handle('load-products', async (event) => {
  const jsonPath = path.join(__dirname, 'data/viiyong_products_full.json');
  if (!fs.existsSync(jsonPath)) {
    return { error: '产品数据文件不存在' };
  }
  const data = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  return data;
});

// 执行匹配
ipcMain.handle('run-match', async (event, { bomPath, products, options }) => {
  try {
    const matcher = require('./matcher-core.js');
    const result = matcher.runMatch(bomPath, products, options);
    return result;
  } catch (err) {
    return { error: err.message };
  }
});

// 导出Excel
ipcMain.handle('export-excel', async (event, { outputPath, data, headers, letters }) => {
  try {
    // data已经是完整的aoa数组，包含表头和数据行
    const ws = XLSX.utils.aoa_to_sheet(data);
    const origWidth = headers.length - 2 - letters.length; // 原表宽度

    ws['!cols'] = [];
    for (let c = 0; c < origWidth; c++) ws['!cols'].push({ wch: 14 });
    for (let i = 0; i < letters.length; i++) ws['!cols'].push({ wch: 26 });
    ws['!cols'].push({ wch: 8 }); // 匹配数量
    ws['!cols'].push({ wch: 10 }); // 匹配状态

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
    XLSX.writeFile(wb, outputPath);

    return { success: true };
  } catch (err) {
    return { error: err.message };
  }
});

// ========== 型号筛选 IPC 处理 ==========

// 执行型号筛选
ipcMain.handle('filter-products', async (event, { products, filterForm }) => {
  try {
    const list = products.list || [];
    
    // 检查是否没有任何筛选条件
    const hasCondition = 
      filterForm.productName || 
      (filterForm.series && filterForm.series.length > 0) ||
      (filterForm.sizes && filterForm.sizes.length > 0) ||
      (filterForm.temps && filterForm.temps.length > 0) ||
      filterForm.capacityValue ||
      (filterForm.deviations && filterForm.deviations.length > 0) ||
      filterForm.voltageValue;
    
    if (!hasCondition) {
      return { error: '请至少设置一个筛选条件，否则会返回全部25933个产品，可能导致卡顿' };
    }

    let result = [];
    const maxResults = 2000; // 限制最大返回数量，防止卡死

    // 预处理筛选条件，提高性能
    const productNameLower = filterForm.productName ? filterForm.productName.toLowerCase() : null;
    const selectedSeries = filterForm.series || [];
    const selectedSizes = filterForm.sizes || [];
    const selectedTemps = filterForm.temps || [];
    const selectedDevs = filterForm.deviations || [];

    // 容量预处理
    let targetPf = null;
    if (filterForm.capacityValue) {
      const inputVal = parseFloat(filterForm.capacityValue);
      if (!isNaN(inputVal)) {
        targetPf = inputVal;
        if (filterForm.capacityUnit === 'nF') targetPf = inputVal * 1e3;
        else if (filterForm.capacityUnit === 'uF') targetPf = inputVal * 1e6;
      }
    }

    // 电压预处理
    let targetVolt = null;
    if (filterForm.voltageValue) {
      const inputVolt = parseFloat(filterForm.voltageValue);
      if (!isNaN(inputVolt)) {
        targetVolt = inputVolt;
      }
    }

    for (const item of list) {
      // 快速判断是否超过最大数量
      if (result.length >= maxResults) {
        event.sender.send('filter-progress', { message: `已达到最大显示数量 ${maxResults}，请添加更多筛选条件` });
        break;
      }

      // 产品型号过滤
      if (productNameLower) {
        if (!item.productName || !item.productName.toLowerCase().includes(productNameLower)) {
          continue;
        }
      }

      // 系列过滤
      if (selectedSeries.length > 0) {
        const series = item.productName ? item.productName[0].toUpperCase() : '';
        if (!selectedSeries.includes(series)) continue;
      }

      // 尺寸过滤
      if (selectedSizes.length > 0) {
        const itemSize = item.size || '';
        let matched = false;
        for (const selSize of selectedSizes) {
          const inchCode = selSize.split('/')[0].trim();
          if (itemSize.includes(inchCode)) {
            matched = true;
            break;
          }
        }
        if (!matched) continue;
      }

      // 温度特性过滤
      if (selectedTemps.length > 0) {
        const itemTemp = (item.tempCharacteristics || '').toUpperCase();
        let matched = false;
        for (const selTemp of selectedTemps) {
          if (itemTemp.includes(selTemp.toUpperCase())) {
            matched = true;
            break;
          }
        }
        if (!matched) continue;
      }

      // 标称容量过滤
      if (targetPf !== null) {
        const itemCap = item.capacity || '';
        const m = itemCap.match(/^([0-9.]+)\s*(pF|nF|uF|µF|mF|p|n|u|µ)$/i);
        if (!m) continue;

        let itemPf = parseFloat(m[1]);
        const u = m[2].toLowerCase();
        if (u === 'pf' || u === 'p') itemPf *= 1;
        else if (u === 'nf' || u === 'n') itemPf *= 1e3;
        else if (u === 'uf' || u === 'µf' || u === 'u' || u === 'µ') itemPf *= 1e6;
        else if (u === 'mf') itemPf *= 1e9;

        if (Math.abs(itemPf - targetPf) > 0.001) continue;
      }

      // 容量偏差过滤
      if (selectedDevs.length > 0) {
        const itemDev = (item.capacityDeviation || '').replace(/\s+/g, '').replace(/\+\/-/g, '±');
        let matched = false;
        for (const selDev of selectedDevs) {
          const normalizedSelDev = selDev.replace(/\s+/g, '');
          if (itemDev === normalizedSelDev) {
            matched = true;
            break;
          }
        }
        if (!matched) continue;
      }

      // 额定电压过滤
      if (targetVolt !== null) {
        const itemVolt = parseFloat(item.voltage);
        if (isNaN(itemVolt) || Math.abs(itemVolt - targetVolt) > 0.001) continue;
      }

      // 添加系列字段
      result.push({
        productName: item.productName || '',
        series: item.productName ? item.productName[0].toUpperCase() : '',
        size: item.size || '',
        tempCharacteristics: item.tempCharacteristics || '',
        capacity: item.capacity || '',
        capacityDeviation: item.capacityDeviation || '',
        voltage: item.voltage || ''
      });
    }

    return { data: result, maxReached: result.length >= maxResults };
  } catch (err) {
    return { error: err.message };
  }
});

// 导出筛选结果Excel
ipcMain.handle('export-filter-excel', async (event, { outputPath, data }) => {
  try {
    const headers = ['产品型号', '系列', '尺寸(Inch/mm)', '温度特性', '标称容量', '容量偏差', '额定电压(Vdc)'];
    const aoa = [headers];

    for (const item of data) {
      aoa.push([
        item.productName || '',
        item.series || '',
        item.size || '',
        item.tempCharacteristics || '',
        item.capacity || '',
        item.capacityDeviation || '',
        item.voltage || ''
      ]);
    }

    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!cols'] = [
      { wch: 25 }, // 产品型号
      { wch: 8 },  // 系列
      { wch: 18 }, // 尺寸
      { wch: 12 }, // 温度特性
      { wch: 15 }, // 标称容量
      { wch: 12 }, // 容量偏差
      { wch: 15 }  // 额定电压
    ];

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
    XLSX.writeFile(wb, outputPath);

    return { success: true };
  } catch (err) {
    return { error: err.message };
  }
});