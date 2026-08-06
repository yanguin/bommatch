const { app, BrowserWindow, ipcMain, dialog, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const XLSX = require('xlsx');
const licenseChecker = require('./license-checker');

let mainWindow;

function createWindow() {
  // 隐藏菜单栏
  Menu.setApplicationMenu(null);

  mainWindow = new BrowserWindow({
    width: 1000,
    height: 650,
    minWidth: 550,
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

// 授权通过后启动窗口和计时器
function startApp(duration) {
  createWindow();
  // 启动使用计时器（时长由 gitee version.txt 控制，单位：秒）
  licenseChecker.startUsageTimer(duration, () => {
    if (mainWindow) {
      dialog.showMessageBoxSync(mainWindow, {
        type: 'warning',
        title: '提示',
        message: '请关闭并重新启动软件后，继续使用',
        buttons: ['确定'],
        noLink: true
      });
    }
    app.quit();
  });
}

// 启动前先进行联网版本检查（与 gitee version.txt 比对）
app.whenReady().then(async () => {
  const result = await licenseChecker.checkLicense();

  if (!result.enabled) {
    if (result.needsUpdate) {
      // 版本过旧：弹窗提示后退出
      dialog.showMessageBoxSync({
        type: 'warning',
        title: '版本过期',
        message: result.message,
        buttons: ['确定'],
        noLink: true
      });
    } else {
      // 网络错误或软件被禁用
      dialog.showErrorBox('软件暂不可使用', result.message || '该软件暂不可使用，请联系管理员。');
    }
    app.quit();
    return;
  }

  // 版本通过，正常启动（传入远程返回的使用时长）
  startApp(result.duration);
});

app.on('window-all-closed', () => {
  licenseChecker.stopUsageTimer();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', async () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    const result = await licenseChecker.checkLicense();
    if (!result.enabled) {
      if (result.needsUpdate) {
        dialog.showMessageBoxSync({
          type: 'warning',
          title: '版本过期',
          message: result.message,
          buttons: ['确定'],
          noLink: true
        });
      } else {
        dialog.showErrorBox('软件暂不可使用', result.message || '该软件暂不可使用，请联系管理员。');
      }
      app.quit();
      return;
    }
    startApp(result.duration);
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

// 加载强茂产品数据
ipcMain.handle('load-qm-products', async (event) => {
  const jsonPath = path.join(__dirname, 'data/qiangmao_products.json');
  if (!fs.existsSync(jsonPath)) {
    return { error: '强茂产品数据文件不存在' };
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

// 导出Excel（支持多 sheet）
ipcMain.handle('export-excel', async (event, { outputPath, data, headers, letters, sheets }) => {
  try {
    const wb = XLSX.utils.book_new();

    // 多 sheet 模式：sheets 是 [{ sheetName, data, headers, letters }, ...]
    if (sheets && Array.isArray(sheets) && sheets.length > 0) {
      const usedNames = new Set();
      for (const s of sheets) {
        const ws = XLSX.utils.aoa_to_sheet(s.data);
        const origWidth = s.headers.length - 2 - s.letters.length;
        ws['!cols'] = [];
        for (let c = 0; c < origWidth; c++) ws['!cols'].push({ wch: 14 });
        for (let i = 0; i < s.letters.length; i++) ws['!cols'].push({ wch: 26 });
        ws['!cols'].push({ wch: 8 }); // 匹配数量
        ws['!cols'].push({ wch: 10 }); // 匹配状态

        // sheet 名去重（Excel 限制 31 字符，且不能含特殊字符）
        let name = (s.sheetName || 'Sheet').replace(/[\\\/\?\*\[\]:]/g, '_').substring(0, 31);
        let finalName = name;
        let suffix = 1;
        while (usedNames.has(finalName)) {
          const suffixStr = '_' + suffix;
          finalName = name.substring(0, 31 - suffixStr.length) + suffixStr;
          suffix++;
        }
        usedNames.add(finalName);

        XLSX.utils.book_append_sheet(wb, ws, finalName);
      }
    } else {
      // 单 sheet 兼容模式
      const ws = XLSX.utils.aoa_to_sheet(data);
      const origWidth = headers.length - 2 - letters.length;
      ws['!cols'] = [];
      for (let c = 0; c < origWidth; c++) ws['!cols'].push({ wch: 14 });
      for (let i = 0; i < letters.length; i++) ws['!cols'].push({ wch: 26 });
      ws['!cols'].push({ wch: 8 });
      ws['!cols'].push({ wch: 10 });
      XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
    }

    XLSX.writeFile(wb, outputPath);

    return { success: true };
  } catch (err) {
    return { error: err.message };
  }
});

// ========== 型号筛选 IPC 处理 ==========

// 执行型号筛选
ipcMain.handle('filter-products', async (event, { products, filterForm, productNameOnly }) => {
  try {
    const list = products.list || [];

    // 如果 productNameOnly 为 true，只根据 productName 进行筛选
    if (productNameOnly) {
      if (!filterForm.productName || filterForm.productName.trim() === '') {
        return { error: '请输入产品型号' };
      }

      let result = [];
      const maxResults = 2000;
      const productNameLower = filterForm.productName.toLowerCase();

      for (const item of list) {
        if (result.length >= maxResults) {
          event.sender.send('filter-progress', { message: `已达到最大显示数量 ${maxResults}，请添加更多筛选条件` });
          break;
        }

        // 只根据 productName 进行模糊匹配
        if (item.productName && item.productName.toLowerCase().includes(productNameLower)) {
          result.push({
            productName: item.productName || '',
            series: item.productName ? item.productName[0].toUpperCase() : '',
            size: item.size || '',
            tempCharacteristics: item.tempCharacteristics || '',
            capacity: item.capacity || '',
            capacityDeviation: item.capacityDeviation || '',
            voltage: item.voltage || '',
            specs: item.specs || []  // 返回规格书信息
          });
        }
      }

      return { data: result, maxReached: result.length >= maxResults };
    }

    // 正常筛选流程（根据所有筛选项）
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
      const totalCount = products.total || (products.list ? products.list.length : 0);
      return { error: `请至少设置一个筛选条件,否则会返回全部${totalCount}个产品,可能导致卡顿` };
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
        const itemInchCode = itemSize.split('/')[0].trim();  // 取产品的 inch 码（如 0603/1608M → 0603）
        let matched = false;
        for (const selSize of selectedSizes) {
          const inchCode = selSize.split('/')[0].trim();  // 取筛选条件的 inch 码
          if (itemInchCode === inchCode) {  // 精确匹配
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

      // 添加系列字段 + specs
      result.push({
        productName: item.productName || '',
        series: item.productName ? item.productName[0].toUpperCase() : '',
        size: item.size || '',
        tempCharacteristics: item.tempCharacteristics || '',
        capacity: item.capacity || '',
        capacityDeviation: item.capacityDeviation || '',
        voltage: item.voltage || '',
        specs: item.specs || []
      });
    }

    return { data: result, maxReached: result.length >= maxResults };
  } catch (err) {
    return { error: err.message };
  }
});

// 导出筛选结果Excel
ipcMain.handle('export-filter-excel', async (event, { outputPath, data, customHeaders }) => {
  try {
    let headers, aoa;

    if (customHeaders && Array.isArray(customHeaders) && customHeaders.length > 0) {
      // 通用导出模式：使用自定义表头，data 是对象数组
      headers = customHeaders;
      aoa = [headers];
      for (const item of data) {
        aoa.push(headers.map(h => item[h] !== undefined ? item[h] : ''));
      }
    } else {
      // 微容默认格式
      headers = ['产品型号', '系列', '尺寸(Inch/mm)', '温度特性', '标称容量', '容量偏差', '额定电压(Vdc)'];
      aoa = [headers];
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
    }

    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!cols'] = headers.map(() => ({ wch: 15 }));

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
    XLSX.writeFile(wb, outputPath);

    return { success: true };
  } catch (err) {
    return { error: err.message };
  }
});

// 窗口置顶切换
ipcMain.handle('toggle-pin-window', async (event) => {
  if (mainWindow) {
    const isPinned = mainWindow.isAlwaysOnTop();
    mainWindow.setAlwaysOnTop(!isPinned);
    return { pinned: !isPinned };
  }
  return { pinned: false };
});

// 获取窗口置顶状态
ipcMain.handle('get-pin-status', async (event) => {
  if (mainWindow) {
    return { pinned: mainWindow.isAlwaysOnTop() };
  }
  return { pinned: false };
});