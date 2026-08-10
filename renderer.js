// 渲染进程主逻辑
const { ipcRenderer, shell } = require('electron');
const matcherCore = require('./matcher-core.js');

new Vue({
  el: '#app',
  data() {
    return {
      // 状态
      loading: false,
      loadingText: '',
      matching: false,
      filtering: false,

      // 当前模式：bom 或 filter
      activeMode: 'bom',

      // 文件路径
      bomPath: '',
      outputPath: '',

      // 规格表头配置
      descColumnName: '物料描述',

      // 产品数据
      products: null,

      // BOM匹配选项
      selectedSeries: ['A', 'T', 'B', 'V'],
      fuzzyTolerance: 0.00, // 默认改为0.00

      // BOM匹配结果
      matchData: null,
      stats: null,
      currentSheetIndex: 0,

      // BOM搜索和筛选
      searchText: '',
      searchColumn: '',
      filterStatus: '',

      // 型号筛选表单
      filterForm: {
        productName: '',
        series: [],
        sizes: [],
        temps: [],
        capacityValue: '',
        capacityUnit: 'pF',
        deviations: [],
        voltageValue: '',
        rf: false,
        highPower: false,
        softTerminal: false
      },

      // 型号筛选结果
      filterResult: null,
      filterSearchText: '',

      // 表格高度
      tableHeight: 600,

      // 窗口置顶状态
      isPinned: false,

      // 当前品牌：weirong(微容) / qiangmao(强茂)
      currentBrand: 'weirong',

      // 强茂产品数据
      qmProducts: null,

      // 强茂多型号输入（多行文本）
      qmInputText: '',

      // 强茂解析出的型号列表（复选框）
      qmParsedItems: [],

      // 强茂筛选结果
      qmFilterResult: null,
      qmSearchText: '',
      qmFiltering: false,

      // 命名规则悬浮窗
      namingRulesVisible: false,
      namingRulesZoom: 1,
      namingRulesPos: null
    };
  },

  computed: {
    // 当前 sheet 数据
    currentSheet() {
      if (!this.matchData || !this.matchData.sheets) return null;
      return this.matchData.sheets[this.currentSheetIndex] || null;
    },

    // sheet 列表（用于切换标签）
    sheetList() {
      if (!this.matchData || !this.matchData.sheets) return [];
      return this.matchData.sheets.map((s, idx) => ({
        index: idx,
        name: s.sheetName,
        skipped: s.skipped,
        total: s.stats ? s.stats.total : 0,
        parsed: s.stats ? s.stats.parsed : 0
      }));
    },

    // BOM匹配结果过滤（基于当前 sheet）
    filteredResults() {
      if (!this.currentSheet || !this.currentSheet.data) return [];
      let results = this.currentSheet.data.tableData || [];

      if (this.filterStatus) {
        results = results.filter(row => row.status === this.filterStatus);
      }

      if (this.searchText) {
        const keyword = this.searchText.toLowerCase();
        if (this.searchColumn) {
          results = results.filter(row => {
            const value = row[this.searchColumn];
            return value && value.toLowerCase().includes(keyword);
          });
        } else {
          results = results.filter(row => {
            return (row.desc && row.desc.toLowerCase().includes(keyword)) ||
                   (row.matchNames && row.matchNames.toLowerCase().includes(keyword));
          });
        }
      }

      return results;
    },

    // 型号筛选结果过滤
    filteredFilterResult() {
      if (!this.filterResult) return [];
      if (!this.filterSearchText) return this.filterResult;

      const keyword = this.filterSearchText.toLowerCase();
      return this.filterResult.filter(item =>
        item.productName && item.productName.toLowerCase().includes(keyword)
      );
    },

    // 强茂筛选结果过滤
    filteredQmFilterResult() {
      if (!this.qmFilterResult) return [];
      if (!this.qmSearchText) return this.qmFilterResult;

      const keyword = this.qmSearchText.toLowerCase();
      return this.qmFilterResult.filter(item =>
        (item.partNumber || '').toLowerCase().includes(keyword)
      );
    }
  },

  methods: {
    // 命名规则悬浮窗：Ctrl+滚轮缩放
    handleNamingRulesWheel(e) {
      if (!e.ctrlKey) return;
      e.preventDefault();
      const delta = e.deltaY < 0 ? 0.1 : -0.1;
      let next = Math.round((this.namingRulesZoom + delta) * 100) / 100;
      if (next < 0.5) next = 0.5;
      if (next > 3) next = 3;
      this.namingRulesZoom = next;
    },

    // 命名规则悬浮窗：标题栏拖动
    startDragNamingRules(e) {
      // 点击关闭/重置按钮时不触发拖动
      if (e.target.closest('.naming-rules-popup-close')) return;
      e.preventDefault();
      const popup = document.querySelector('.naming-rules-popup');
      if (!popup) return;
      const rect = popup.getBoundingClientRect();
      const offsetX = e.clientX - rect.left;
      const offsetY = e.clientY - rect.top;
      // 首次拖动时，从当前实际位置开始
      this.namingRulesPos = { x: rect.left, y: rect.top };
      const onMove = (ev) => {
        this.namingRulesPos = {
          x: ev.clientX - offsetX,
          y: ev.clientY - offsetY
        };
      };
      const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    },

    // 切换模式
    switchMode(mode) {
      this.activeMode = mode;
      this.$nextTick(() => {
        this.calcTableHeight();
      });
    },

    // 计算表格高度
    calcTableHeight() {
      this.$nextTick(() => {
        const rightPanel = document.querySelector('.right-panel');
        const resultsHeader = document.querySelector('.results-header');
        const sheetTabs = document.querySelector('.sheet-tabs');

        if (rightPanel && resultsHeader) {
          const panelHeight = rightPanel.offsetHeight;
          const headerHeight = resultsHeader.offsetHeight;
          const sheetTabsHeight = sheetTabs ? sheetTabs.offsetHeight + 10 : 0;
          const padding = 30; // 上下padding

          this.tableHeight = Math.max(panelHeight - headerHeight - sheetTabsHeight - padding, 200);
        } else {
          this.tableHeight = Math.max(window.innerHeight - 150, 200);
        }
      });
    },

    // 选择BOM文件
    async selectBomFile() {
      const paths = await ipcRenderer.invoke('select-file');
      if (paths && paths.length > 0) {
        this.bomPath = paths[0];
      }
    },

    // 加载产品数据
    async loadProducts() {
      this.loading = true;
      this.loadingText = '正在加载产品数据...';
      this.products = await ipcRenderer.invoke('load-products');
      this.loading = false;

      if (this.products.error) {
        this.$message.error(this.products.error);
        return false;
      }
      return true;
    },

    // BOM匹配
    async runMatch() {
      if (!this.bomPath) {
        this.$message.warning('请先选择BOM表文件');
        return;
      }

      if (!this.products) {
        const loaded = await this.loadProducts();
        if (!loaded) return;
      }

      this.matching = true;
      this.loading = true;
      this.loadingText = `正在进行匹配分析...（系列: ${this.selectedSeries.join(', ') || '全部'}）`;

      try {
        const result = await ipcRenderer.invoke('run-match', {
          bomPath: this.bomPath,
          products: this.products,
          options: {
            selectedSeries: this.selectedSeries,
            exactFirst: true,
            fuzzyTolerance: this.fuzzyTolerance,
            descColumnName: this.descColumnName || '物料描述'
          }
        });

        if (result.error) {
          this.$message.error(result.error);
          return;
        }

        this.processMatchResult(result);

        if (result.stats) {
          const matchedLetters = result.stats.letters || [];
          const sheetInfo = result.totalSheets > 1
            ? `（共 ${result.totalSheets} 个 sheet，成功 ${result.validSheets} 个）`
            : '';
          this.$message.success(`匹配完成！匹配结果包含系列: ${matchedLetters.join(', ')}${sheetInfo}`);
        }
      } catch (err) {
        this.$message.error('匹配失败: ' + err.message);
      } finally {
        this.matching = false;
        this.loading = false;
      }
    },

    // 处理匹配结果（多 sheet）
    // 注意：原始大数据（rows/results/items）存到非响应式的 this.sheetsRawData，
    //       matchData.sheets 里只存轻量 tableData，避免 Vue 深度响应式化导致卡死
    processMatchResult(result) {
      this.stats = result.stats;
      const allLetters = result.stats.letters || [];

      // 非响应式存储原始数据（用于导出 Excel）
      this.sheetsRawData = [];

      const sheets = result.sheets.map((sheetResult, sheetIdx) => {
        const { rows, headerIdx, descCol, results, origWidth, letters } = sheetResult.data;
        const sheetLetters = letters.length > 0 ? letters : allLetters;

        // 原始数据存到非响应式变量
        this.sheetsRawData[sheetIdx] = { rows, headerIdx, descCol, results, origWidth, letters: sheetLetters };

        const tableData = [];
        if (!sheetResult.skipped) {
          for (let i = 0; i < results.length; i++) {
            const rowIndex = headerIdx + 1 + i;
            const row = rows[rowIndex] || [];
            const res = results[i];

            const specsList = (res.items || []).flatMap((it) => it.specs || []);

            const item = {
              originalIndex: i + 1,
              index: i + 1,
              desc: row[descCol] || '',
              status: res.status,
              matchCount: res.names.length,
              matchNames: res.names.join('\n'),
              // 冻结 specsList，Vue 2 会跳过对冻结对象的响应式转换
              specsList: Object.freeze(specsList)
            };

            for (const letter of sheetLetters) {
              const arr = res.byLetter.get(letter);
              item['letter_' + letter] = arr && arr.length > 0 ? arr.map((it) => it.name).join('\n') : null;
            }

            tableData.push(item);
          }
        }

        // matchData.sheets 里只存轻量数据，不含 rows/results/items
        return {
          sheetName: sheetResult.sheetName,
          skipped: sheetResult.skipped,
          reason: sheetResult.reason,
          stats: sheetResult.stats,
          data: { tableData },
          displayLetters: sheetLetters
        };
      });

      this.matchData = { sheets, totalSheets: result.totalSheets, validSheets: result.validSheets };
      this.currentSheetIndex = 0;

      this.$nextTick(() => {
        this.calcTableHeight();
      });
    },

    // 切换 sheet
    switchSheet(idx) {
      if (idx === this.currentSheetIndex) return;
      this.currentSheetIndex = idx;
      // 切换时清空搜索筛选
      this.searchText = '';
      this.searchColumn = '';
      this.filterStatus = '';
      this.$nextTick(() => {
        this.calcTableHeight();
      });
    },

    // 打开规格书链接
    openSpecUrl(url) {
      if (!url) {
        this.$message.warning('该产品暂无规格书');
        return;
      }
      // 补全域名（FileUrl 是相对路径）
      const fullUrl = url.startsWith('http') ? url : 'https://www.viiyong.com' + url;
      shell.openExternal(fullUrl);
    },

    // 导出BOM匹配Excel（多 sheet）
    async exportExcel() {
      if (!this.matchData) {
        this.$message.warning('请先执行匹配');
        return;
      }

      const defaultName = this.bomPath.replace(/\.(xlsx|xls)$/i, '_viiyong匹配.xlsx');
      const savePath = await ipcRenderer.invoke('save-file', defaultName);

      if (!savePath) return;

      this.loading = true;
      this.loadingText = '正在导出Excel...';

      try {
        const sheetsPayload = [];

        for (let idx = 0; idx < this.matchData.sheets.length; idx++) {
          const sheetResult = this.matchData.sheets[idx];
          if (sheetResult.skipped) continue;

          // 原始数据从非响应式变量取
          const raw = this.sheetsRawData[idx];
          if (!raw) continue;
          const { rows, headerIdx, results, origWidth } = raw;
          const letters = sheetResult.displayLetters || [];
          const extraHeaders = [...letters.map(l => this.getSeriesLabel(l)), '匹配数量', '匹配状态'];
          const aoa = [];

          for (let i = 0; i <= headerIdx; i++) {
            const r = (rows[i] || []).slice();
            while (r.length < origWidth) r.push(null);
            if (i === headerIdx) r.push(...extraHeaders);
            aoa.push(r);
          }

          for (let k = 0; k < results.length; k++) {
            const rowIdx = headerIdx + 1 + k;
            const r = (rows[rowIdx] || []).slice();
            while (r.length < origWidth) r.push(null);
            const res = results[k];

            for (const L of letters) {
              const arr = res.byLetter.get(L);
              r.push(arr && arr.length > 0 ? arr.map((it) => it.name).join('\n') : null);
            }

            r.push(res.names.length);
            r.push(res.status);
            aoa.push(r);
          }

          sheetsPayload.push({
            sheetName: sheetResult.sheetName,
            data: aoa,
            headers: aoa[headerIdx],
            letters: letters
          });
        }

        const exportResult = await ipcRenderer.invoke('export-excel', {
          outputPath: savePath,
          sheets: sheetsPayload
        });

        if (exportResult.success) {
          this.$message.success('导出成功: ' + savePath);
        } else {
          this.$message.error('导出失败: ' + exportResult.error);
        }
      } catch (err) {
        this.$message.error('导出失败: ' + err.message);
      } finally {
        this.loading = false;
      }
    },

    // ============ 型号筛选功能 ============

    // 解析产品型号文本并自动填充筛选条件
    parseAndFill() {
      const text = this.filterForm.productName;
      if (!text || text.trim() === '') {
        this.$message.warning('请先输入规格描述或产品型号');
        return false;
      }

      try {
        // 判断输入是否为产品型号（以A/T/B/V开头，容量码可含R表示小数点，如5R6=5.6pF）
        const trimmedText = text.trim().toUpperCase();
        const isProductName = /^[ATBV][\dR]{3}[A-Z]\d{4}/.test(trimmedText);

        let spec = null;

        if (isProductName) {
          // 尝试使用 parseProductName 解析产品型号
          spec = matcherCore.parseProductName(text);
        }

        // 如果微容型号解析失败，尝试其他品牌MLCC型号解析（国巨/风华/火炬/村田）
        if (!spec) {
          spec = matcherCore.parseOtherBrandMlcc(text);
        }

        // 如果产品型号解析失败，尝试使用宽松解析提取规格字段
        if (!spec) {
          spec = matcherCore.parseDescLoose(text);
        }

        if (!spec) {
          this.$message.warning('无法解析该规格描述或产品型号，请检查格式是否正确');
          return false;
        }

        // 解析成功，自动填充各个筛选项

        // 1. 系列选择（仅产品型号解析才有）
        if (spec.series) {
          const seriesLabel = spec.series;
          if (!this.filterForm.series.includes(seriesLabel)) {
            this.filterForm.series = [seriesLabel];
          }
        }

        // 2. 尺寸代码映射
        const sizeMap = {
          '0201': '0201/0603M',
          '0402': '0402/1005M',
          '0603': '0603/1608M',
          '0805': '0805/2012M',
          '1206': '1206/3216M',
          '1210': '1210/3225M',
          '2220': '2220/5750M'
        };

        if (spec.size) {
          // 如果 size 已经是完整格式（如 "1210/3225M"），直接使用
          if (spec.size.includes('/')) {
            if (!this.filterForm.sizes.includes(spec.size)) {
              this.filterForm.sizes = [spec.size];
            }
          } else {
            const sizeLabel = sizeMap[spec.size] || null;
            if (sizeLabel && !this.filterForm.sizes.includes(sizeLabel)) {
              this.filterForm.sizes = [sizeLabel];
            }
          }
        }

        // 3. 温度特性映射
        const tempMap = {
          'C0G': 'C0G',
          'X5R': 'X5R',
          'X6S': 'X6S',
          'X6T': 'X6T',
          'X7R': 'X7R',
          'X7S': 'X7S',
          'X7T': 'X7T',
          'X8G': 'X8G',
          'X8L': 'X8L',
          'X3H': 'X3H'
        };

        if (spec.temp) {
          const tempLabel = tempMap[spec.temp] || null;
          if (tempLabel && !this.filterForm.temps.includes(tempLabel)) {
            this.filterForm.temps = [tempLabel];
          }
        }

        // 4. 容量值和单位转换
        if (spec.cap !== null) {
          const capPf = spec.cap;
          // 根据大小选择合适的单位显示
          if (capPf >= 1e6) {
            // >= 1uF，显示 uF
            this.filterForm.capacityValue = (capPf / 1e6).toString();
            this.filterForm.capacityUnit = 'uF';
          } else if (capPf >= 1e3) {
            // >= 1nF，显示 nF
            this.filterForm.capacityValue = (capPf / 1e3).toString();
            this.filterForm.capacityUnit = 'nF';
          } else {
            // < 1nF，显示 pF
            this.filterForm.capacityValue = capPf.toString();
            this.filterForm.capacityUnit = 'pF';
          }
        }

        // 5. 偏差映射
        const devMap = {
          '±0.05pF': '±0.05pF',
          '±0.1pF': '±0.1pF',
          '±0.25pF': '±0.25pF',
          '±0.5pF': '±0.5pF',
          '±1%': '±1%',
          '±2%': '±2%',
          '±5%': '±5%',
          '±10%': '±10%',
          '±20%': '±20%'
        };

        if (spec.dev) {
          const devLabel = devMap[spec.dev] || null;
          if (devLabel && !this.filterForm.deviations.includes(devLabel)) {
            this.filterForm.deviations = [devLabel];
          }
        }

        // 6. 电压值
        if (spec.volt !== null) {
          this.filterForm.voltageValue = spec.volt.toString();
        }

        // 清空输入框
        this.filterForm.productName = '';

        // 统计已识别的字段
        const identified = [];
        if (spec.series) identified.push('系列');
        if (spec.size) identified.push('尺寸');
        if (spec.temp) identified.push('介质');
        if (spec.cap !== null && spec.cap !== undefined) identified.push('容量');
        if (spec.dev) identified.push('偏差');
        if (spec.volt !== null && spec.volt !== undefined) identified.push('电压');

        if (identified.length > 0) {
          this.$message.success(`解析成功，已填充: ${identified.join('、')}`);
        } else {
          this.$message.warning('解析成功，但未识别到有效字段');
        }
        return true;

      } catch (err) {
        this.$message.error('解析失败: ' + err.message);
        return false;
      }
    },

    // 仅根据型号查询（忽略其他筛选项）
    async parseAndQuery() {
      const text = this.filterForm.productName;
      if (!text || text.trim() === '') {
        this.$message.warning('请先输入产品型号');
        return;
      }

      this.filtering = true;
      this.loading = true;
      this.loadingText = '正在筛选产品...';

      try {
        if (!this.products) {
          const loaded = await this.loadProducts();
          if (!loaded) return;
        }

        // 只根据 productName 进行筛选，忽略其他筛选项
        const result = await ipcRenderer.invoke('filter-products', {
          products: this.products,
          filterForm: {
            productName: this.filterForm.productName
          },
          productNameOnly: true  // 标记只根据型号匹配
        });

        if (result.error) {
          this.$message.warning(result.error);
          return;
        }

        // 冻结每条结果的 specs，避免 Vue 深度响应式化
        this.filterResult = result.data.map(item => ({
          ...item,
          specs: Object.freeze(item.specs || [])
        }));

        // 显示筛选结果
        if (result.maxReached) {
          this.$message.warning(`筛选结果已达最大显示数量 (2000条)，建议添加更多筛选条件以缩小范围`);
        } else {
          this.$message.success(`筛选完成，共找到 ${result.data.length} 个产品`);
        }

        this.$nextTick(() => {
          this.calcTableHeight();
        });
      } catch (err) {
        this.$message.error('筛选失败: ' + err.message);
      } finally {
        this.filtering = false;
        this.loading = false;
      }
    },

    // 执行型号筛选
    async runFilter() {
      if (!this.products) {
        const loaded = await this.loadProducts();
        if (!loaded) return;
      }

      this.filtering = true;
      this.loading = true;
      this.loadingText = '正在筛选产品...';

      try {
        const result = await ipcRenderer.invoke('filter-products', {
          products: this.products,
          filterForm: this.filterForm
        });

        if (result.error) {
          this.$message.warning(result.error);
          return;
        }

        // 冻结每条结果的 specs，避免 Vue 深度响应式化
        this.filterResult = result.data.map(item => ({
          ...item,
          specs: Object.freeze(item.specs || [])
        }));

        // 显示筛选结果
        if (result.maxReached) {
          this.$message.warning(`筛选结果已达最大显示数量 (2000条)，建议添加更多筛选条件以缩小范围`);
        } else {
          this.$message.success(`筛选完成，共找到 ${result.data.length} 个产品`);
        }

        this.$nextTick(() => {
          this.calcTableHeight();
        });
      } catch (err) {
        this.$message.error('筛选失败: ' + err.message);
      } finally {
        this.filtering = false;
        this.loading = false;
      }
    },

    resetFilter() {
      this.filterForm = {
        productName: '',
        series: [],
        sizes: [],
        temps: [],
        capacityValue: '',
        capacityUnit: 'pF',
        deviations: [],
        voltageValue: '',
        rf: false,
        highPower: false,
        softTerminal: false
      };
      this.filterResult = null;
      this.filterSearchText = '';
      this.$message.success('已重置筛选条件');
    },

    async exportFilterResult() {
      if (!this.filterResult || this.filterResult.length === 0) {
        this.$message.warning('没有可导出的数据');
        return;
      }

      const savePath = await ipcRenderer.invoke('save-file', 'viiyong产品筛选结果.xlsx');

      if (!savePath) return;

      this.loading = true;
      this.loadingText = '正在导出Excel...';

      try {
        const exportResult = await ipcRenderer.invoke('export-filter-excel', {
          outputPath: savePath,
          data: this.filterResult
        });

        if (exportResult.success) {
          this.$message.success('导出成功: ' + savePath);
        } else {
          this.$message.error('导出失败: ' + exportResult.error);
        }
      } catch (err) {
        this.$message.error('导出失败: ' + err.message);
      } finally {
        this.loading = false;
      }
    },

    // 获取状态标签类型
    getStatusType(status) {
      const typeMap = {
        '精确匹配': 'success',
        '忽略偏差': 'primary',
        '容差匹配': 'warning',
        '未匹配': 'info',
        '未解析': 'danger',
        '空描述': 'info'
      };
      return typeMap[status] || 'info';
    },

    // 获取系列标签类型
    getSeriesTagType(series) {
      const typeMap = {
        'A': 'danger',
        'T': 'warning',
        'B': 'primary',
        'V': 'success'
      };
      return typeMap[series] || 'info';
    },

    // 获取系列名称（用于表头显示）
    getSeriesLabel(letter) {
      const labelMap = {
        'A': 'A系列',
        'T': 'T系列',
        'B': 'B系列',
        'V': 'V系列'
      };
      return labelMap[letter] || letter;
    },

    // 获取产品特点标签列表（系列 + 特点，去重）
    getFeatureTags(row) {
      const tags = [];
      // 系列标签（带系列配色）
      const seriesLabel = row.series ? this.getSeriesLabel(row.series) : '';
      if (seriesLabel) {
        tags.push({ label: seriesLabel, type: this.getSeriesTagType(row.series) });
      }
      // 特点标签（顿号分隔，跳过与系列重复的）
      if (row.features) {
        const parts = row.features.split('、').map(s => s.trim()).filter(s => s);
        for (const p of parts) {
          if (seriesLabel && p === seriesLabel) continue;
          tags.push({ label: p, type: 'info' });
        }
      }
      return tags;
    },

    // ============ 品牌切换 ============
    switchBrand(brand) {
      this.currentBrand = brand;
      this.$nextTick(() => {
        this.calcTableHeight();
      });
    },

    // ============ 强茂型号筛选 ============
    // 加载强茂产品数据
    async loadQmProducts() {
      if (this.qmProducts) return this.qmProducts;
      try {
        const data = await ipcRenderer.invoke('load-qm-products');
        if (data.error) {
          this.$message.error(data.error);
          return null;
        }
        this.qmProducts = data;
        return data;
      } catch (err) {
        this.$message.error('加载强茂产品数据失败: ' + err.message);
        return null;
      }
    },

    // 解析多行输入为复选框列表
    async parseQmInput() {
      const text = (this.qmInputText || '').trim();
      if (!text) {
        this.$message.warning('请输入产品型号');
        return;
      }

      // 加载产品数据
      const products = await this.loadQmProducts();
      if (!products || !products.list) return;

      // 按换行分割，提取型号
      const lines = text.split(/[\n\r]+/).map(l => l.trim()).filter(l => l);
      if (lines.length === 0) {
        this.$message.warning('未识别到产品型号');
        return;
      }

      // 构建型号索引（去空格，大写比较）
      const productMap = new Map();
      for (const item of products.list) {
        const pn = (item.partNumber || '').trim().toUpperCase();
        if (pn) productMap.set(pn, item);
      }

      let found = 0;
      let notFound = 0;
      for (const line of lines) {
        const pnKey = line.toUpperCase();
        // 精确匹配
        if (productMap.has(pnKey)) {
          // 避免重复添加
          if (!this.qmParsedItems.some(it => it.partNumber.toUpperCase() === pnKey)) {
            this.qmParsedItems.push({
              partNumber: productMap.get(pnKey).partNumber,
              checked: true
            });
            found++;
          }
        } else {
          // 模糊匹配（包含关系）
          let matched = false;
          for (const [key, item] of productMap) {
            if (key.includes(pnKey) || pnKey.includes(key)) {
              if (!this.qmParsedItems.some(it => it.partNumber.toUpperCase() === key)) {
                this.qmParsedItems.push({
                  partNumber: item.partNumber,
                  checked: true
                });
                found++;
                matched = true;
              }
            }
          }
          if (!matched) {
            this.qmParsedItems.push({
              partNumber: line,
              checked: false
            });
            notFound++;
          }
        }
      }

      // 清空文本框
      this.qmInputText = '';

      if (found > 0 && notFound > 0) {
        this.$message.success(`解析完成：找到 ${found} 个，未找到 ${notFound} 个`);
      } else if (found > 0) {
        this.$message.success(`解析完成：找到 ${found} 个产品`);
      } else {
        this.$message.warning(`解析完成：${notFound} 个型号未在产品库中找到`);
      }
    },

    // 强茂查询（基于复选框勾选的型号）
    async runQmFilter() {
      const checkedItems = this.qmParsedItems.filter(it => it.checked);
      if (checkedItems.length === 0) {
        this.$message.warning('请选择产品型号');
        return;
      }

      this.qmFiltering = true;
      this.loading = true;
      this.loadingText = '正在查询强茂产品...';

      try {
        const products = await this.loadQmProducts();
        if (!products || !products.list) {
          this.qmFilterResult = [];
          return;
        }

        // 构建型号索引
        const productMap = new Map();
        for (const item of products.list) {
          const pn = (item.partNumber || '').trim().toUpperCase();
          if (pn) productMap.set(pn, item);
        }

        // 根据勾选的型号查询
        const results = [];
        for (const checked of checkedItems) {
          const pnKey = checked.partNumber.toUpperCase();
          if (productMap.has(pnKey)) {
            results.push(productMap.get(pnKey));
          } else {
            // 模糊匹配
            for (const [key, item] of productMap) {
              if (key.includes(pnKey) || pnKey.includes(key)) {
                results.push(item);
              }
            }
          }
        }

        this.qmFilterResult = results;
        if (results.length > 0) {
          this.$message.success(`查询完成，共 ${results.length} 条结果`);
        } else {
          this.$message.warning('未找到匹配的产品');
        }
      } catch (err) {
        this.$message.error('查询失败: ' + err.message);
      } finally {
        this.qmFiltering = false;
        this.loading = false;
      }
    },

    // 强茂清空解析列表
    clearQmParsed() {
      this.qmParsedItems = [];
    },

    // 强茂全选/全不选
    toggleQmAll(val) {
      this.qmParsedItems.forEach(it => { it.checked = val; });
    },

    // 强茂导出
    async exportQmFilterResult() {
      if (!this.qmFilterResult || this.qmFilterResult.length === 0) {
        this.$message.warning('没有可导出的数据');
        return;
      }

      const savePath = await ipcRenderer.invoke('save-file', '强茂产品筛选结果.xlsx');
      if (!savePath) return;

      this.loading = true;
      this.loadingText = '正在导出Excel...';

      try {
        // 构建导出数据和表头（不含规格书列）
        const exportHeaders = [
          '产品型号', '封装', '产品状态', '极性', '配置',
          'VDS(V)', 'VGS(±V)', 'ID(A)',
          'RDS(on)@10V(mΩ)', 'RDS(on)@4.5V(mΩ)',
          'Ciss(pF)', 'VGS(th)(V)', 'Qg@10V(nC)'
        ];
        const exportData = this.qmFilterResult.map(item => ({
          '产品型号': item.partNumber || '',
          '封装': item.package || '',
          '产品状态': item.productStatus || '',
          '极性': item.polarity || '',
          '配置': item.config || '',
          'VDS(V)': item.vds || '',
          'VGS(±V)': item.vgs || '',
          'ID(A)': item.id || '',
          'RDS(on)@10V(mΩ)': item.rdsOn_10V || '',
          'RDS(on)@4.5V(mΩ)': item.rdsOn_4_5V || '',
          'Ciss(pF)': item.ciss || '',
          'VGS(th)(V)': item.vgsTh || '',
          'Qg@10V(nC)': item.qg_10V || ''
        }));

        const exportResult = await ipcRenderer.invoke('export-filter-excel', {
          outputPath: savePath,
          data: exportData,
          customHeaders: exportHeaders
        });

        if (exportResult.success) {
          this.$message.success('导出成功: ' + savePath);
        } else {
          this.$message.error('导出失败: ' + exportResult.error);
        }
      } catch (err) {
        this.$message.error('导出失败: ' + err.message);
      } finally {
        this.loading = false;
      }
    },

    // 窗口置顶切换
    async togglePin() {
      const result = await ipcRenderer.invoke('toggle-pin-window');
      this.isPinned = result.pinned;
    },

    // 获取当前置顶状态
    async getPinStatus() {
      const result = await ipcRenderer.invoke('get-pin-status');
      this.isPinned = result.pinned;
    }
  },

  mounted() {
    // 初始化表格高度
    this.calcTableHeight();

    // 初始化窗口置顶状态
    this.getPinStatus();

    // 监听窗口大小变化（使用防抖优化性能）
    let resizeTimer = null;
    window.addEventListener('resize', () => {
      if (resizeTimer) clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        this.calcTableHeight();
      }, 100);
    });

    // 监听页面加载完成
    this.$nextTick(() => {
      this.calcTableHeight();
    });
  }
});
