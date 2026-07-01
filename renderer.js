// 渲染进程主逻辑
const { ipcRenderer } = require('electron');
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
        voltageValue: ''
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

      // 强茂型号筛选表单（仅产品型号）
      qmFilterForm: {
        productName: ''
      },

      // 强茂筛选结果
      qmFilterResult: null,
      qmSearchText: '',
      qmFiltering: false
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
      if (!this.currentSheet) return [];
      let results = this.currentSheet.tableData;

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
        item.productName && item.productName.toLowerCase().includes(keyword)
      );
    }
  },

  methods: {
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
    processMatchResult(result) {
      this.stats = result.stats;
      const allLetters = result.stats.letters || [];

      // 为每个 sheet 构建 tableData
      const sheets = result.sheets.map((sheetResult) => {
        const { rows, headerIdx, descCol, results, origWidth, letters } = sheetResult.data;
        const sheetLetters = letters.length > 0 ? letters : allLetters;

        const tableData = [];
        if (!sheetResult.skipped) {
          for (let i = 0; i < results.length; i++) {
            const rowIndex = headerIdx + 1 + i;
            const row = rows[rowIndex] || [];
            const res = results[i];

            const item = {
              originalIndex: i + 1,
              index: i + 1,
              desc: row[descCol] || '',
              status: res.status,
              matchCount: res.names.length,
              matchNames: res.names.join('\n')
            };

            for (const letter of sheetLetters) {
              const arr = res.byLetter.get(letter);
              item['letter_' + letter] = arr && arr.length > 0 ? arr.join('\n') : null;
            }

            tableData.push(item);
          }
        }

        return {
          ...sheetResult,
          data: { ...sheetResult.data, tableData },
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

        for (const sheetResult of this.matchData.sheets) {
          if (sheetResult.skipped) continue;
          const { rows, headerIdx, results, origWidth } = sheetResult.data;
          const letters = sheetResult.displayLetters || [];
          const extraHeaders = [...letters, '匹配数量', '匹配状态'];
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
              r.push(arr && arr.length > 0 ? arr.join('\n') : null);
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
        this.$message.warning('请先输入规格描述');
        return false;
      }

      try {
        // 使用 matcher-core 的 parseDesc 函数解析
        const spec = matcherCore.parseDesc(text);

        if (!spec) {
          this.$message.warning('无法解析该规格描述，请检查格式是否正确');
          return false;
        }

        // 解析成功，自动填充各个筛选项

        // 1. 尺寸代码映射
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
          const sizeLabel = sizeMap[spec.size] || null;
          if (sizeLabel && !this.filterForm.sizes.includes(sizeLabel)) {
            this.filterForm.sizes = [sizeLabel];
          }
        }

        // 2. 温度特性映射
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

        // 3. 容量值和单位转换
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

        // 4. 偏差映射
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

        // 5. 电压值
        if (spec.volt !== null) {
          this.filterForm.voltageValue = spec.volt.toString();
        }

        // 清空输入框
        this.filterForm.productName = '';

        this.$message.success('解析成功，已自动填充筛选条件');
        return true;

      } catch (err) {
        this.$message.error('解析失败: ' + err.message);
        return false;
      }
    },

    // 解析并立即查询
    async parseAndQuery() {
      const parseSuccess = this.parseAndFill();
      if (parseSuccess) {
        // 等待 Vue 更新完成
        await this.$nextTick();
        // 执行查询
        await this.runFilter();
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

        this.filterResult = result.data;

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
        voltageValue: ''
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

    // ============ 品牌切换 ============
    switchBrand(brand) {
      this.currentBrand = brand;
      this.$nextTick(() => {
        this.calcTableHeight();
      });
    },

    // ============ 强茂型号筛选 ============
    // 强茂查询（暂未接入产品数据）
    async runQmFilter() {
      if (!this.qmFilterForm.productName || !this.qmFilterForm.productName.trim()) {
        this.$message.warning('请输入产品型号');
        return;
      }

      this.qmFiltering = true;
      this.loading = true;
      this.loadingText = '正在查询强茂产品...';

      try {
        // 强茂产品数据暂未爬取，暂不接入实际查询
        this.$message.info('强茂产品数据暂未上线，敬请期待');
        this.qmFilterResult = [];
      } catch (err) {
        this.$message.error('查询失败: ' + err.message);
      } finally {
        this.qmFiltering = false;
        this.loading = false;
      }
    },

    // 强茂清空
    resetQmFilter() {
      this.qmFilterForm.productName = '';
      this.qmFilterResult = null;
      this.qmSearchText = '';
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
        const exportResult = await ipcRenderer.invoke('export-filter-excel', {
          outputPath: savePath,
          data: this.qmFilterResult
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
