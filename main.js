const { app, BrowserWindow, ipcMain, dialog, Menu, net } = require('electron');
const path = require('path');
const fs = require('fs');
const XLSX = require('xlsx');
const licenseChecker = require('./license-checker');

// 更新/通知所需的 Windows 应用标识（与 package.json 的 appId 保持一致）
app.setAppUserModelId('com.viiyong.bom-matcher');

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

// 热更新：启动后后台检查新版本，下载完成后弹窗询问重启安装
function setupAutoUpdater() {
  // 开发模式或未打包时不检查（避免每次调试都触发）
  if (!app.isPackaged || process.argv.includes('--dev')) return;

  const { autoUpdater } = require('electron-updater');
  autoUpdater.autoDownload = true; // 发现新版本自动后台下载
  autoUpdater.forceRunAfter = true; // 安装完成后自动重新启动应用

  // [诊断-临时] 暴露更新检查各阶段结果，用于定位热更新不弹窗的问题；定位后移除
  autoUpdater.on('update-available', (info) => {
    dialog.showMessageBoxSync({
      type: 'info',
      title: '诊断',
      message: '发现新版本 v' + info.version + '，开始后台下载',
      buttons: ['确定'],
      noLink: true
    });
  });
  autoUpdater.on('update-not-available', () => {
    dialog.showMessageBoxSync({
      type: 'info',
      title: '诊断',
      message: '已是最新版本，无需更新',
      buttons: ['确定'],
      noLink: true
    });
  });
  autoUpdater.on('error', (e) => {
    dialog.showMessageBoxSync({
      type: 'error',
      title: '诊断-更新错误',
      message: e && e.message || String(e),
      buttons: ['确定'],
      noLink: true
    });
  });

  // 下载完成：弹窗询问是否立即重启安装
  autoUpdater.on('update-downloaded', (info) => {
    const win = BrowserWindow.getAllWindows()[0];
    const options = {
      type: 'question',
      title: '发现新版本',
      message: `新版本 v${info.version} 已下载完成，重启后生效。\n是否立即重启安装？`,
      buttons: ['立即重启', '稍后'],
      defaultId: 0,
      cancelId: 1,
      noLink: true
    };
    const choice = win ? dialog.showMessageBoxSync(win, options) : dialog.showMessageBoxSync(options);
    if (choice === 0) {
      autoUpdater.quitAndInstall();
    }
  });

  // [诊断-临时] 检查失败也弹窗显示原因；定位后还原为静默
  autoUpdater.checkForUpdates().catch((e) => {
    dialog.showMessageBoxSync({
      type: 'error',
      title: '诊断-检查失败',
      message: e && e.message || String(e),
      buttons: ['确定'],
      noLink: true
    });
  });
}

// 授权通过后启动窗口和计时器
function startApp(duration) {
  createWindow();
  // 启动后台热更新检查（仅打包版生效，失败静默）
  setupAutoUpdater();
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
}).catch((err) => {
  console.error('应用启动失败:', err);
  dialog.showErrorBox('启动失败', `应用启动过程中发生错误: ${err && err.message ? err.message : err}`);
  app.quit();
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

// 加载 JSON 产品数据（复用：viiyong / 强茂）
function loadJsonData(relativePath, notFoundMsg) {
  const jsonPath = path.join(__dirname, relativePath);
  if (!fs.existsSync(jsonPath)) {
    return { error: notFoundMsg };
  }
  try {
    return JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  } catch (err) {
    return { error: `产品数据解析失败: ${err.message}` };
  }
}

// 加载viiyong产品数据
ipcMain.handle('load-products', async (event) => {
  return loadJsonData('data/viiyong_products_full.json', '产品数据文件不存在');
});

// 加载强茂产品数据
ipcMain.handle('load-qm-products', async (event) => {
  return loadJsonData('data/qiangmao_products.json', '强茂产品数据文件不存在');
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

// 清洗 features 字段的 HTML，提取纯文本并用顿号分隔
function cleanFeatures(html) {
  if (!html) return '';
  return String(html)
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
            features: cleanFeatures(item.features),
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
      filterForm.voltageValue ||
      filterForm.rf ||
      filterForm.highPower ||
      filterForm.softTerminal;

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

      // 产品特点过滤（射频/高功率/软端子）
      if (filterForm.rf || filterForm.highPower || filterForm.softTerminal) {
        const feats = cleanFeatures(item.features);
        if (filterForm.rf && !feats.includes('射频')) continue;
        if (filterForm.highPower && !feats.includes('高功率')) continue;
        if (filterForm.softTerminal && !feats.includes('软端子')) continue;
      }

      // 添加系列字段 + 产品特点 + specs
      result.push({
        productName: item.productName || '',
        series: item.productName ? item.productName[0].toUpperCase() : '',
        features: cleanFeatures(item.features),
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

// 多型号顺序查询：一次建索引，按输入顺序返回结果
// 支持两类输入：产品型号（精确/模糊匹配）与规格描述（如 CCAP,560pF,±10%,50V,X7R,SMD0402）
// series：匹配系列查询条件（如 ['A','T']），限定产品搜索范围；空/未传 = 匹配全部
ipcMain.handle('filter-products-multi', async (event, { products, names, series, exactOnly }) => {
  try {
    const { parseDescLoose } = require('./matcher-core.js');
    // 入参防御：产品数据
    if (!products || !products.list) {
      return { error: '产品数据未加载' };
    }
    // 入参防御：names 数组
    if (!Array.isArray(names) || names.length === 0) {
      return { error: '请输入产品型号' };
    }
    // 元素校验：剔除非字符串与超长项（单条 > 100 字符）
    const validNames = [];
    for (const n of names) {
      if (typeof n === 'string' && n.trim() && n.length <= 100) {
        validNames.push(n.trim());
      }
    }
    if (validNames.length === 0) {
      return { error: '未识别到有效产品型号' };
    }
    // 保留重复输入（重复粘贴的型号各自成组、各自计数，与用户输入一一对应）
    let truncated = false;
    let finalNames = validNames;
    if (validNames.length > 200) {
      truncated = true;
      finalNames = validNames.slice(0, 200);
    }

    // 系列查询条件：限定产品搜索范围（A/T/B/V），空集 = 不过滤
    const seriesSet = new Set();
    if (Array.isArray(series)) {
      for (const s of series) {
        if (typeof s === 'string' && /^[ATBV]$/.test(s)) seriesSet.add(s);
      }
    }
    const list = seriesSet.size > 0
      ? products.list.filter(item => item.productName && seriesSet.has(item.productName[0].toUpperCase()))
      : products.list;

    // 一次遍历建索引：productName(大写) → item，O(M)
    const indexMap = new Map();
    for (const item of list) {
      if (item.productName && !indexMap.has(item.productName.toUpperCase())) {
        indexMap.set(item.productName.toUpperCase(), item);
      }
    }

    const result = [];
    let matchedInputs = 0;
    let unmatchedInputs = 0;
    const maxResults = 2000; // 防御上限：规格匹配单输入可出多行，重复输入也各自计数
    let maxReached = false;

    // 按 names 顺序遍历（index = inputIndex）
    for (let i = 0; i < finalNames.length; i++) {
      const name = finalNames[i];
      const nameUpper = name.toUpperCase();

      // 先精确匹配（"仅本型号"模式下仅此一步，不做模糊与规格匹配）
      let hit = indexMap.get(nameUpper);

      // 非"仅本型号"模式：未中再模糊匹配（与单型号 parseAndQuery 的 includes 行为一致）
      if (!exactOnly) {
        if (!hit) {
          for (const item of list) {
            if (item.productName && item.productName.toUpperCase().includes(nameUpper)) {
              hit = item;
              break;
            }
          }
        }

        // 仍未命中时，尝试按规格描述匹配（以容量为锚定字段，避免型号误判）
        // 例：CCAP,560pF,±10%,50V,X7R,SMD0402
        if (!hit) {
          const spec = parseDescLoose(name);
          if (spec && spec.cap !== null && spec.cap !== undefined) {
            const specHits = [];
            for (const item of list) {
              // 尺寸（spec.size 为 inch 码，如 0402；item.size 形如 "0402/1005M"）
              if (spec.size) {
                if ((item.size || '').split('/')[0].trim() !== spec.size) continue;
              }
              // 介质（NP0 已归一为 C0G）
              if (spec.temp) {
                if (!(item.tempCharacteristics || '').toUpperCase().includes(spec.temp)) continue;
              }
              // 标称容量
              const capM = (item.capacity || '').match(/^([0-9.]+)\s*(pF|nF|uF|µF|mF|p|n|u|µ)$/i);
              if (!capM) continue;
              let itemPf = parseFloat(capM[1]);
              const cu = capM[2].toLowerCase();
              if (cu === 'nf' || cu === 'n') itemPf *= 1e3;
              else if (cu === 'uf' || cu === 'µf' || cu === 'u' || cu === 'µ') itemPf *= 1e6;
              else if (cu === 'mf') itemPf *= 1e9;
              if (Math.abs(itemPf - spec.cap) > 0.001) continue;
              // 额定电压
              if (spec.volt !== null && spec.volt !== undefined) {
                const itemVolt = parseFloat(item.voltage);
                if (isNaN(itemVolt) || Math.abs(itemVolt - spec.volt) > 0.001) continue;
              }
              // 容量偏差
              if (spec.dev) {
                const itemDev = (item.capacityDeviation || '').replace(/\s+/g, '').replace(/\+\/-/g, '±');
                if (itemDev !== spec.dev) continue;
              }
              specHits.push(item);
            }

            if (specHits.length > 0) {
              matchedInputs++;
              for (const item of specHits) {
                if (result.length >= maxResults) {
                  maxReached = true;
                  continue;
                }
                result.push({
                  inputName: name,
                  inputIndex: i,
                  hitCount: specHits.length,
                  productName: item.productName || '',
                  series: item.productName ? item.productName[0].toUpperCase() : '',
                  features: cleanFeatures(item.features),
                  size: item.size || '',
                  tempCharacteristics: item.tempCharacteristics || '',
                  capacity: item.capacity || '',
                  capacityDeviation: item.capacityDeviation || '',
                  voltage: item.voltage || '',
                  specs: item.specs || []
                });
              }
              continue;
            }
          }
        }
      }

      // 完全未匹配：也生成占位行，保证每条输入在表格中可见（与统计口径一致）
      if (!hit) {
        unmatchedInputs++;
        if (result.length < maxResults) {
          result.push({
            inputName: name,
            inputIndex: i,
            unmatched: true,
            hitCount: 0,
            productName: '',
            series: '',
            features: '',
            size: '',
            tempCharacteristics: '',
            capacity: '',
            capacityDeviation: '',
            voltage: '',
            specs: []
          });
        }
        continue;
      }

      // 精确/模糊命中：每条输入都生成自己的行（不同输入命中同一产品时重复展示，便于逐行核对）
      matchedInputs++;
      if (result.length >= maxResults) {
        maxReached = true;
        continue;
      }

      result.push({
        inputName: name,
        inputIndex: i,
        hitCount: 1,
        productName: hit.productName || '',
        series: hit.productName ? hit.productName[0].toUpperCase() : '',
        features: cleanFeatures(hit.features),
        size: hit.size || '',
        tempCharacteristics: hit.tempCharacteristics || '',
        capacity: hit.capacity || '',
        capacityDeviation: hit.capacityDeviation || '',
        voltage: hit.voltage || '',
        specs: hit.specs || []
      });
    }

    // data 按输入顺序（inputIndex 升序）自然成立：外层按 names 顺序遍历
    return {
      data: result,
      stats: {
        totalInputs: finalNames.length,
        matchedInputs,
        unmatchedInputs,
        // 产品数排除"未匹配"占位行
        productCount: result.filter(r => !r.unmatched).length
      },
      maxReached,
      truncated
    };
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
      headers = ['产品型号', '产品特点', '尺寸(Inch/mm)', '温度特性', '标称容量', '容量偏差', '额定电压(Vdc)'];
      aoa = [headers];
      for (const item of data) {
        aoa.push([
          item.productName || '',
          item.features || '',
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

// ========== 规格书下载 IPC 处理 ==========

// 选择目录（多选下载时选父目录）
ipcMain.handle('select-directory', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory', 'createDirectory']
  });
  return result.canceled ? null : result.filePaths[0];
});

// 单份规格书：另存为对话框（文件名预填产品型号）
ipcMain.handle('save-spec-file', async (event, defaultName) => {
  const result = await dialog.showSaveDialog(mainWindow, {
    defaultPath: defaultName,
    filters: [{ name: 'PDF文件', extensions: ['pdf'] }]
  });
  return result.canceled ? null : result.filePath;
});

// 用 Electron net 下载单个文件到 dest（跟随 Chromium 网络栈/系统代理）
function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    const request = net.request(encodeURI(url));
    // 超时保护：30 秒无响应则中止
    const timer = setTimeout(() => {
      request.abort();
      reject(new Error('下载超时'));
    }, 30000);
    request.on('response', (response) => {
      if (response.statusCode !== 200) {
        clearTimeout(timer);
        response.resume();
        reject(new Error('HTTP ' + response.statusCode));
        return;
      }
      const ws = fs.createWriteStream(dest);
      response.pipe(ws);
      ws.on('finish', () => {
        clearTimeout(timer);
        ws.close(resolve);
      });
      ws.on('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });
    });
    request.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    request.end();
  });
}

// 批量下载规格书
// tasks: [{ url, productName, origName, saveName }]，全部落到 dir（不存在则创建）
// writeList 为 true 时在 dir 下生成「下载清单.md」（原名 → 新名映射 + 成功/失败清单）
ipcMain.handle('download-specs', async (event, { dir, tasks, writeList, dupProducts, selectedCount }) => {
  try {
    if (!dir || !Array.isArray(tasks) || tasks.length === 0) {
      return { error: '下载参数无效' };
    }
    fs.mkdirSync(dir, { recursive: true });

    const results = [];
    for (let i = 0; i < tasks.length; i++) {
      const t = tasks[i];
      event.sender.send('spec-dl-progress', { done: i, total: tasks.length, name: t.saveName });
      const dest = path.join(dir, t.saveName);
      try {
        await downloadFile(t.url, dest);
        results.push({ productName: t.productName, origName: t.origName, saveName: t.saveName, ok: true });
      } catch (err) {
        // 失败时删掉可能残留的半截文件
        try { if (fs.existsSync(dest)) fs.unlinkSync(dest); } catch (e) { /* 忽略清理失败 */ }
        results.push({ productName: t.productName, origName: t.origName, saveName: t.saveName, ok: false, reason: err.message });
      }
    }
    event.sender.send('spec-dl-progress', { done: tasks.length, total: tasks.length, name: '' });

    const okCount = results.filter(r => r.ok).length;
    let listPath = null;
    if (writeList) {
      const now = new Date();
      const pad = (n) => String(n).padStart(2, '0');
      const timeStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
      const lines = [
        '# 规格书下载清单',
        '',
        `- 下载时间：${timeStr}`,
        `- 保存目录：${dir}`,
        `- 共 ${results.length} 个，成功 ${okCount} 个，失败 ${results.length - okCount} 个`
      ];
      // 重复型号统计：同一型号勾选了多行，下载时按型号去重（只下载一份）
      if (Array.isArray(dupProducts) && dupProducts.length > 0) {
        const dupTotal = dupProducts.reduce((s, d) => s + d.count - 1, 0);
        lines.push(`- 勾选 ${selectedCount} 行，其中 ${dupTotal} 行为重复型号，下载时已去重`);
        lines.push('', `## 重复型号（${dupProducts.length} 个）`, '');
        for (const d of dupProducts) {
          lines.push(`- ${d.name} *${d.count}`);
        }
      }
      lines.push('', '| 序号 | 产品型号 | 原PDF文件名 | 保存为 | 状态 |', '|---|---|---|---|---|');
      results.forEach((r, i) => {
        lines.push(`| ${i + 1} | ${r.productName} | ${r.origName} | ${r.saveName} | ${r.ok ? '成功' : '失败：' + r.reason} |`);
      });
      lines.push('');
      listPath = path.join(dir, '下载清单.md');
      fs.writeFileSync(listPath, lines.join('\n'), 'utf8');
    }

    return { dir, listPath, total: results.length, okCount, failed: results.filter(r => !r.ok) };
  } catch (err) {
    return { error: err.message };
  }
});

// 获取窗口置顶状态
ipcMain.handle('get-pin-status', async (event) => {
  if (mainWindow) {
    return { pinned: mainWindow.isAlwaysOnTop() };
  }
  return { pinned: false };
});