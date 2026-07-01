// 渲染进程主逻辑
const { ipcRenderer } = require('electron');

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
      tableHeight: 600
    };
  },

  computed: {
    // BOM匹配结果过滤
    filteredResults() {
      if (!this.matchData) return [];
      let results = this.matchData.tableData;

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

        if (rightPanel && resultsHeader) {
          const panelHeight = rightPanel.offsetHeight;
          const headerHeight = resultsHeader.offsetHeight;
          const padding = 30; // 上下padding

          this.tableHeight = Math.max(panelHeight - headerHeight - padding, 200);
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
          this.$message.success(`匹配完成！匹配结果包含系列: ${matchedLetters.join(', ')}`);
        }
      } catch (err) {
        this.$message.error('匹配失败: ' + err.message);
      } finally {
        this.matching = false;
        this.loading = false;
      }
    },

    // 处理匹配结果
    processMatchResult(result) {
      this.stats = result.stats;
      const { rows, headerIdx, descCol, results, origWidth, letters } = result.data;

      const tableData = [];
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

        for (const letter of letters) {
          const arr = res.byLetter.get(letter);
          item['letter_' + letter] = arr && arr.length > 0 ? arr.join('\n') : null;
        }

        tableData.push(item);
      }

      this.matchData = { rows, headerIdx, descCol, results, origWidth, letters, tableData };

      this.$nextTick(() => {
        this.calcTableHeight();
      });
    },

    // 导出BOM匹配Excel
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
        const { rows, headerIdx, results, origWidth, letters } = this.matchData;
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

        const exportResult = await ipcRenderer.invoke('export-excel', {
          outputPath: savePath,
          data: aoa,
          headers: aoa[headerIdx],
          letters: letters
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
    }
  },

  mounted() {
    // 初始化表格高度
    this.calcTableHeight();

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
