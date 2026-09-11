// 渲染进程主逻辑
const { ipcRenderer, shell, clipboard } = require('electron');
const matcherCore = require('./matcher-core.js');
const resistorMatcher = require('./matcher-resistor.js');
const { splitInputLines } = require('./utils.js');

// 厂家标识 → 中文名（大毅 tab 展示用）
const RESISTOR_BRAND_LABEL = {
  yageo: '国巨',
  koa: '兴亚',
  rohm: '罗姆',
  vishay: '威世',
  prosemi: '普森美',
  dayi: '大毅'
};

// ============ 可复用结果表格骨架 ============
// 统一 stripe/border/高度/表头样式，列通过默认插槽传入
// 用法：<results-table :data="filteredXxx" v-if="..."><el-table-column .../></results-table>
// 内置 Excel 式单元格选区：拖拽画矩形选区，Ctrl+C 复制为 TSV（可直贴 Excel）
Vue.component('results-table', {
  props: {
    data: { type: Array, required: true }
  },
  template: `
    <el-table
      :data="data"
      stripe
      border
      :height="$root.tableHeight"
      style="flex: 1;"
      :header-cell-style="{background:'var(--color-background-secondary)', color:'var(--color-text-secondary)', fontWeight:'var(--font-weight-label)'}"
      @selection-change="$emit('selection-change', $event)"
      @mousedown.native="onTdMouseDown">
      <el-table-column
        type="index"
        width="48"
        align="center"
        fixed="left"
        resizable="false"
        class-name="gutter-col"
        label-class-name="gutter-col">
      </el-table-column>
      <slot></slot>
    </el-table>
  `,
  mounted() {
    document.addEventListener('copy', this.onCopy);
    document.addEventListener('keydown', this.onKeydown);
  },
  beforeDestroy() {
    document.removeEventListener('copy', this.onCopy);
    document.removeEventListener('keydown', this.onKeydown);
    this.clearSelection();
  },
  methods: {
    // 主 body 表 + fixed body 表（fixed 列即全局前 N 列，cellIndex 无需偏移）
    bodyTables() {
      const out = [];
      const main = this.$el.querySelector('.el-table__body-wrapper table');
      if (main) out.push(main);
      const fixed = this.$el.querySelector('.el-table__fixed-body-wrapper table');
      if (fixed) out.push(fixed);
      return out;
    },
    // 由鼠标事件定位 body 单元格（header 区域与交互元素不参与选区；checkbox 列留给勾选交互）
    cellPos(e) {
      if (e.target.closest('a, button, .el-popover__reference, .el-checkbox')) return null;
      const td = e.target.closest('td');
      if (!td) return null;
      if (!td.closest('.el-table__body-wrapper, .el-table__fixed-body-wrapper')) return null;
      return { r: td.parentElement.rowIndex, c: td.cellIndex };
    },
    // mousedown 起点 → 拖动超阈值(4px)进入单元格选区模式 → mousemove 更新终点 → mouseup 定格
    // 单击/双击不进入选区模式，保留原生行为（双击选中单元格内部分文字如 C0G）
    onTdMouseDown(e) {
      if (e.button !== 0) return;
      const pos = this.cellPos(e);
      if (!pos) return;
      this.clearSelection(); // 每次按下重置旧选区
      this._pending = { x: e.clientX, y: e.clientY, pos };
      // 以鼠标坐标定位终点单元格（滚动后 e.target 不更新，须用 elementFromPoint 重查）
      const updateEnd = (clientX, clientY) => {
        const el = document.elementFromPoint(clientX, clientY);
        const td = el && el.closest ? el.closest('td') : null;
        if (!td || !td.closest('.el-table__body-wrapper, .el-table__fixed-body-wrapper')) return;
        const p = { r: td.parentElement.rowIndex, c: td.cellIndex };
        if (p.r !== this._sel.r2 || p.c !== this._sel.c2) {
          this._sel.r2 = p.r;
          this._sel.c2 = p.c;
          this.paintSelection();
        }
      };
      // 拖到可视区上/下边缘时自动滚动表格（Excel 行为），否则超出可视高度的行选不到
      const wrapper = this.$el.querySelector('.el-table__body-wrapper');
      let scrollTimer = null;
      let lastX = e.clientX, lastY = e.clientY;
      const onMove = (ev) => {
        if (!this._pending) return;
        if (!this._sel) {
          const dx = ev.clientX - this._pending.x;
          const dy = ev.clientY - this._pending.y;
          if (dx * dx + dy * dy < 16) return; // 未超过 4px：视为点击/选词，不启动单元格选区
          this._sel = { r1: this._pending.pos.r, c1: this._pending.pos.c, r2: this._pending.pos.r, c2: this._pending.pos.c };
          this.paintSelection();
        }
        // 已进入选区模式：持续清除拖拽产生的原生文本选择（字符流）
        const native = window.getSelection();
        if (native) native.removeAllRanges();
        ev.preventDefault();
        lastX = ev.clientX; lastY = ev.clientY;
        updateEnd(lastX, lastY);
        // 边缘检测：距上/下边缘 30px 内启动自动滚动，越靠边滚得越快
        if (wrapper) {
          const rect = wrapper.getBoundingClientRect();
          const EDGE = 30;
          let speed = 0;
          if (lastY < rect.top + EDGE) speed = -Math.max(4, (rect.top + EDGE - lastY) / 2);
          else if (lastY > rect.bottom - EDGE) speed = Math.max(4, (lastY - (rect.bottom - EDGE)) / 2);
          if (speed !== 0 && !scrollTimer) {
            scrollTimer = setInterval(() => {
              wrapper.scrollTop += speed;
              updateEnd(lastX, lastY); // 内容滚动后按当前鼠标位置更新终点
            }, 50);
          } else if (speed === 0 && scrollTimer) {
            clearInterval(scrollTimer);
            scrollTimer = null;
          }
        }
      };
      const onUp = () => {
        if (scrollTimer) { clearInterval(scrollTimer); scrollTimer = null; }
        this._pending = null;
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    },
    // 重绘选区高亮：主表与 fixed 克隆表两份 DOM 同步加类
    paintSelection() {
      if (this._marked) {
        for (const el of this._marked) el.classList.remove('cell-selected');
      }
      this._marked = [];
      if (!this._sel) return;
      const minR = Math.min(this._sel.r1, this._sel.r2);
      const maxR = Math.max(this._sel.r1, this._sel.r2);
      const minC = Math.min(this._sel.c1, this._sel.c2);
      const maxC = Math.max(this._sel.c1, this._sel.c2);
      for (const table of this.bodyTables()) {
        const rows = table.rows;
        for (let r = minR; r <= maxR && r < rows.length; r++) {
          const cells = rows[r].cells;
          for (let c = minC; c <= maxC && c < cells.length; c++) {
            if (cells[c].classList.contains('sel-col')) continue; // 勾选列不高亮
            cells[c].classList.add('cell-selected');
            this._marked.push(cells[c]);
          }
        }
      }
    },
    clearSelection() {
      if (this._marked) {
        for (const el of this._marked) el.classList.remove('cell-selected');
      }
      this._marked = [];
      this._sel = null;
    },
    onKeydown(e) {
      if (e.key === 'Escape') this.clearSelection();
    },
    // Ctrl+C / 右键复制：选区数据组织为 TSV（\t 分列、\r\n 分行，可直贴 Excel/WPS）
    onCopy(e) {
      if (!this._sel) return;
      // 原生文本选择优先（如双击选中型号文字）
      const native = window.getSelection();
      if (native && native.toString().trim()) return;
      const tables = this.bodyTables();
      if (tables.length === 0) return;
      const main = tables[0]; // 主表包含全部列
      const minR = Math.min(this._sel.r1, this._sel.r2);
      const maxR = Math.max(this._sel.r1, this._sel.r2);
      const minC = Math.min(this._sel.c1, this._sel.c2);
      const maxC = Math.max(this._sel.c1, this._sel.c2);
      const lines = [];
      for (let r = minR; r <= maxR && r < main.rows.length; r++) {
        const cells = main.rows[r].cells;
        const cols = [];
        for (let c = minC; c <= maxC && c < cells.length; c++) {
          if (cells[c].classList.contains('sel-col')) continue; // 勾选列不进入 TSV
          // 单元格内换行/制表符替换为空格，避免破坏 TSV 结构；逐行原样输出保持行对齐
          cols.push((cells[c].innerText || '').replace(/[\t\n\r]+/g, ' ').trim());
        }
        lines.push(cols.join('\t'));
      }
      if (lines.length === 0) return;
      // 只提供纯文本 TSV：这是 Excel 自身复制单元格用的格式，兼容性最好。
      // 不提供 text/html——Excel/WPS 会优先解析 HTML，个别版本解析 <table> 会丢行
      e.clipboardData.setData('text/plain', lines.join('\r\n'));
      e.preventDefault();
      // 复制反馈：提示数量即剪贴板实际行数；若与粘贴结果不符，问题在粘贴目标表（筛选/隐藏行/合并单元格）
      const colCount = Math.max(0, maxC - minC + 1);
      this.$message({ message: `已复制 ${lines.length} 行 × ${colCount} 列`, type: 'success', duration: 1500 });
    }
  }
});

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
      // 型号筛选结果表格勾选的行（用于规格书批量下载/浏览器打开）
      specSelectedRows: [],

      // 型号筛选输入模式：single 单型号 / multi 多型号
      filterInputMode: 'single',
      // 多型号 textarea 内容
      filterMultiText: '',
      // 多型号态匹配系列筛选（A/T/B/V，默认全选；空数组=匹配全部）
      filterMultiSeries: ['A', 'T', 'B', 'V'],
      // 多型号查询统计：{ totalInputs, matchedInputs, unmatchedInputs, productCount }
      filterMultiStats: null,

      // 表格高度
      tableHeight: 600,

      // 窗口置顶状态
      isPinned: false,

      // 当前品牌：weirong(微容) / qiangmao(强茂)
      currentBrand: 'weirong',

      // 强茂产品数据
      qmProducts: null,

      // 强茂输入模式：single 单型号 / multi 多型号
      qmInputMode: 'single',
      // 强茂单型号输入
      qmSingleText: '',
      // 强茂多型号输入（多行文本）
      qmInputText: '',
      // 强茂多型号查询统计：{ totalInputs, matchedInputs, unmatchedInputs, productCount }
      qmMultiStats: null,

      // 强茂筛选结果
      qmFilterResult: null,
      qmSearchText: '',
      qmFiltering: false,

      // 大毅（电阻）型号换算
      // 输入模式：single 单型号 / multi 多型号
      dyInputMode: 'single',
      dySingleText: '',     // 单型号输入
      dyInputText: '',      // 多行输入：他牌电阻型号
      dyResult: null,       // 换算结果数组
      dySearchText: '',
      dyStatusFilter: '',   // '' / ok / fail
      dyParsing: false,

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
    // 匹配系列是查询条件（点"开始匹配"时传给后端限定搜索范围），不在此处实时过滤结果；
    // 勾选变化不影响已查询出的结果，仅右侧搜索框过滤
    filteredFilterResult() {
      if (!this.filterResult) return [];
      const results = this.filterResult;

      if (!this.filterSearchText) return results;

      const keyword = this.filterSearchText.toLowerCase();
      // 多型号态：同时匹配输入型号与产品型号；单型号态：仅产品型号
      if (this.filterInputMode === 'multi') {
        return results.filter(item =>
          (item.inputName && item.inputName.toLowerCase().includes(keyword)) ||
          (item.productName && item.productName.toLowerCase().includes(keyword))
        );
      }
      return results.filter(item =>
        item.productName && item.productName.toLowerCase().includes(keyword)
      );
    },

    // 多型号态：当前视图（搜索后）仍有命中行的输入数（按 inputIndex 去重）。
    // 未匹配型号 = 输入总数 - 本值，使统计与表格中的"未匹配"占位行口径一致
    multiMatchedInputs() {
      if (this.filterInputMode !== 'multi' || !this.filterResult) return 0;
      const set = new Set();
      for (const r of this.filteredFilterResult) {
        if (!r.unmatched && r.inputIndex !== undefined) set.add(r.inputIndex);
      }
      return set.size;
    },

    // 强茂筛选结果过滤
    filteredQmFilterResult() {
      if (!this.qmFilterResult) return [];
      if (!this.qmSearchText) return this.qmFilterResult;

      const keyword = this.qmSearchText.toLowerCase();
      return this.qmFilterResult.filter(item =>
        (item.partNumber || '').toLowerCase().includes(keyword)
      );
    },

    // 大毅换算结果统计
    dyStats() {
      if (!this.dyResult) return { total: 0, ok: 0, fail: 0 };
      const ok = this.dyResult.filter(r => r.dayiModel).length;
      return { total: this.dyResult.length, ok, fail: this.dyResult.length - ok };
    },

    // 大毅换算结果过滤（关键字 + 状态）
    filteredDyResult() {
      if (!this.dyResult) return [];
      let rows = this.dyResult;

      if (this.dyStatusFilter === 'ok') {
        rows = rows.filter(r => !!r.dayiModel);
      } else if (this.dyStatusFilter === 'fail') {
        rows = rows.filter(r => !r.dayiModel);
      }

      if (!this.dySearchText) return rows;
      const keyword = this.dySearchText.toLowerCase();
      return rows.filter(item =>
        (item.input || '').toLowerCase().includes(keyword) ||
        (item.dayiModel || '').toLowerCase().includes(keyword)
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
      try {
        const paths = await ipcRenderer.invoke('select-file');
        if (paths && paths.length > 0) {
          this.bomPath = paths[0];
        }
      } catch (err) {
        this.$message.error('选择BOM文件失败: ' + err.message);
      }
    },

    // 加载产品数据
    async loadProducts() {
      this.loading = true;
      this.loadingText = '正在加载产品数据...';
      try {
        this.products = await ipcRenderer.invoke('load-products');
        if (this.products && this.products.error) {
          this.$message.error(this.products.error);
          return false;
        }
        return true;
      } catch (err) {
        this.$message.error('加载产品数据失败: ' + err.message);
        return false;
      } finally {
        this.loading = false;
      }
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
      shell.openExternal(this.specFullUrl(url));
    },

    // 补全规格书 URL（FileUrl 是相对路径）
    specFullUrl(url) {
      return url.startsWith('http') ? url : 'https://www.viiyong.com' + url;
    },

    // 型号筛选表格勾选变化
    onSpecSelectionChange(rows) {
      this.specSelectedRows = rows;
    },

    // 收集勾选行的规格书下载任务
    // 命名规则：产品型号.pdf；同型号重复（多行或一个产品多份规格书）时加 _2/_3 后缀
    // 返回 { tasks, skippedRows, dupProducts, dupRowCount }：
    //   tasks = [{ url, productName, origName, saveName }]
    //   dupProducts = [{ name, count }] 被勾选多行的型号（下载时已去重，只下一次）
    //   dupRowCount = 因重复勾选被去重的行数
    collectSpecTasks() {
      const tasks = [];
      const skippedRows = [];
      const usedNames = new Map();
      const seen = new Set(); // 同一产品同一份规格书只下一次（多行命中同一产品时去重）
      const productRowCount = new Map(); // 产品型号 → 勾选行数（含重复勾选）
      for (const row of this.specSelectedRows) {
        if (row.unmatched || !row.specs || row.specs.length === 0) {
          skippedRows.push(row);
          continue;
        }
        productRowCount.set(row.productName, (productRowCount.get(row.productName) || 0) + 1);
        for (const spec of row.specs) {
          const url = this.specFullUrl(spec.FileUrl);
          const dedupKey = row.productName + '|' + url;
          if (seen.has(dedupKey)) continue;
          seen.add(dedupKey);
          let base = String(row.productName || '规格书').replace(/[\\/:*?"<>|]/g, '_');
          const n = (usedNames.get(base) || 0) + 1;
          usedNames.set(base, n);
          if (n > 1) base = `${base}_${n}`;
          // 原文件名：取 URL 最后一段；取不到时用 Title 兜底
          let origName = '';
          try { origName = decodeURIComponent(spec.FileUrl.split('/').pop()) || ''; } catch (e) { /* 保留原样 */ }
          if (!origName) origName = spec.Title || spec.FileUrl;
          tasks.push({ url, productName: row.productName, origName, saveName: base + '.pdf' });
        }
      }
      const dupProducts = [...productRowCount.entries()]
        .filter(([, n]) => n > 1)
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count || (a.name < b.name ? -1 : 1));
      const dupRowCount = [...productRowCount.values()].reduce((s, n) => s + (n - 1), 0);
      return { tasks, skippedRows, dupProducts, dupRowCount };
    },

    // 下载勾选的规格书
    async downloadSelectedSpecs() {
      if (this.specSelectedRows.length === 0) {
        this.$message.warning('请先勾选要下载的产品行');
        return;
      }
      const { tasks, skippedRows, dupProducts, dupRowCount } = this.collectSpecTasks();
      if (tasks.length === 0) {
        this.$message.warning('勾选的行都没有规格书');
        return;
      }

      let dir;
      if (tasks.length === 1) {
        // 单份：另存为对话框，文件名预填产品型号
        const savePath = await ipcRenderer.invoke('save-spec-file', tasks[0].saveName);
        if (!savePath) return;
        dir = savePath.replace(/[\\/][^\\/]+$/, '');
        tasks[0].saveName = savePath.split(/[\\/]/).pop();
      } else {
        // 多份：先选父目录，再命名子文件夹
        const baseDir = await ipcRenderer.invoke('select-directory');
        if (!baseDir) return;
        const now = new Date();
        const pad = (n) => String(n).padStart(2, '0');
        const defaultFolder = `规格书_${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}`;
        const ret = await this.$prompt('规格书将放入该文件夹', '下载规格书', {
          inputValue: defaultFolder,
          inputValidator: (v) => {
            if (!v || !v.trim()) return '文件夹名不能为空';
            if (/[\\/:*?"<>|]/.test(v)) return '文件夹名不能包含 \\ / : * ? " < > |';
            return true;
          }
        }).catch(() => null);
        if (!ret) return;
        dir = baseDir + '\\' + ret.value.trim();
      }

      this.loading = true;
      this.loadingText = `正在下载规格书 0/${tasks.length} ...`;
      try {
        const res = await ipcRenderer.invoke('download-specs', {
          dir,
          tasks,
          writeList: tasks.length > 1, // 多份时生成「下载清单.md」
          dupProducts,                // 重复勾选的型号清单（写入 md）
          selectedCount: this.specSelectedRows.length
        });
        if (res.error) {
          this.$message.error('下载失败: ' + res.error);
          return;
        }
        let msg = `下载完成：成功 ${res.okCount}/${res.total}`;
        if (dupRowCount > 0) msg += `（勾选 ${this.specSelectedRows.length} 行，${dupRowCount} 行重复型号已去重）`;
        if (res.failed.length > 0) msg += `，失败 ${res.failed.length} 个（详见清单）`;
        if (skippedRows.length > 0) msg += `；${skippedRows.length} 行无规格书已跳过`;
        this.$message({
          message: msg,
          type: res.failed.length > 0 ? 'warning' : 'success',
          duration: 5000
        });
        // 打开所在目录，方便用户查看
        shell.showItemInFolder(res.listPath || (res.dir + '\\' + tasks[0].saveName));
      } catch (err) {
        this.$message.error('下载失败: ' + err.message);
      } finally {
        this.loading = false;
      }
    },

    // 「更多」下拉命令
    onSpecMoreCmd(cmd) {
      if (cmd === 'download') this.downloadSelectedSpecs();
      else if (cmd === 'open') this.openSelectedSpecs();
      else if (cmd === 'copyModel') this.copySelectedModels();
      else if (cmd === 'copyDetail') this.copySelectedDetails();
    },

    // 复制勾选行的产品型号（多行换行分隔；未匹配行复制"未匹配"）
    copySelectedModels() {
      const names = this.specSelectedRows.map(r => r.productName || (r.unmatched ? '未匹配' : '')).filter(Boolean);
      if (names.length === 0) {
        this.$message.warning('勾选的行没有可复制的产品型号');
        return;
      }
      clipboard.writeText(names.join('\n'));
      let msg = `已复制 ${names.length} 个产品型号`;
      const unmatched = this.specSelectedRows.filter(r => r.unmatched).length;
      if (unmatched > 0) msg += `（含 ${unmatched} 个未匹配的输入型号）`;
      this.$message.success(msg);
    },

    // 复制勾选行的详细信息：型号/英寸尺寸/温度特性/容量/偏差/电压（如 T104K0201X5R100NJT/0201/X5R/100nF/±10%/10V）
    // 尺寸取英寸码（0201/1005M → 0201），温度特性取代码（X5R(-55℃~85℃) → X5R），电压补 V；空段自动省略；多行换行分隔
    // 未匹配行无规格，只复制"未匹配"
    copySelectedDetails() {
      const lines = this.specSelectedRows.map(r => [
        r.productName || (r.unmatched ? '未匹配' : ''),
        String(r.size || '').split('/')[0],
        String(r.tempCharacteristics || '').split('(')[0],
        r.capacity || '',
        r.capacityDeviation || '',
        (r.voltage !== undefined && r.voltage !== null && r.voltage !== '') ? r.voltage + 'V' : ''
      ].filter(s => s !== '').join('/')).filter(Boolean);
      if (lines.length === 0) {
        this.$message.warning('勾选的行没有可复制的信息');
        return;
      }
      clipboard.writeText(lines.join('\n'));
      this.$message.success(`已复制 ${lines.length} 行详细信息`);
    },

    // 用浏览器打开勾选行的全部规格书（用户自选：与下载并存，URL 去重，>10 个先确认）
    async openSelectedSpecs() {
      if (this.specSelectedRows.length === 0) {
        this.$message.warning('请先勾选要打开的产品行');
        return;
      }
      const { tasks } = this.collectSpecTasks();
      if (tasks.length === 0) {
        this.$message.warning('勾选的行都没有规格书');
        return;
      }
      const urls = [...new Set(tasks.map(t => t.url))];
      if (urls.length > 10) {
        const ok = await this.$confirm(`将在浏览器打开 ${urls.length} 个标签页，是否继续？`, '提示', {
          type: 'warning',
          confirmButtonText: '继续',
          cancelButtonText: '取消'
        }).catch(() => null);
        if (!ok) return;
      }
      urls.forEach(u => shell.openExternal(u));
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

    // 筛选共享逻辑：加载产品 → 调用 IPC → 处理结果
    async _invokeFilter(filterFormPayload, productNameOnly) {
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
          filterForm: filterFormPayload,
          productNameOnly: productNameOnly || false
        });

        if (result.error) {
          this.$message.warning(result.error);
          return;
        }

        // 冻结每条结果的 specs，避免 Vue 深度响应式化；rowNo 为结果集内原始行号（不随搜索重编号）
        this.filterResult = result.data.map((item, idx) => ({
          ...item,
          rowNo: idx + 1,
          specs: Object.freeze(item.specs || [])
        }));
        this.specSelectedRows = [];
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

    // 仅根据型号查询（忽略其他筛选项）
    async parseAndQuery() {
      const text = this.filterForm.productName;
      if (!text || text.trim() === '') {
        this.$message.warning('请先输入产品型号');
        return;
      }
      await this._invokeFilter({ productName: this.filterForm.productName }, true);
    },

    // 切换单/多型号输入模式：清空对方态输入与结果
    toggleFilterInputMode() {
      this.filterInputMode = this.filterInputMode === 'single' ? 'multi' : 'single';
      this.filterResult = null;
      this.filterMultiStats = null;
      this.filterSearchText = '';
      if (this.filterInputMode === 'single') this.filterMultiText = '';
      else this.filterForm.productName = '';
    },

    // 多型号顺序查询
    async runMultiFilter() {
      const text = (this.filterMultiText || '').trim();
      if (!text) { this.$message.warning('请输入产品型号'); return; }
      const names = splitInputLines(text, m => this.$message.warning(m));
      if (names.length === 0) { this.$message.warning('未识别到产品型号'); return; }

      if (!this.products) {
        const loaded = await this.loadProducts();
        if (!loaded) return;
      }

      this.filtering = true;
      this.loading = true;
      this.loadingText = `正在按顺序匹配 ${names.length} 个型号...`;

      try {
        const res = await ipcRenderer.invoke('filter-products-multi', {
          products: this.products,
          names,
          // 匹配系列作为查询条件：限定本次搜索的产品范围（空 = 全部）
          series: this.filterMultiSeries
        });

        if (res.error) { this.$message.warning(res.error); return; }

        // 冻结每条结果的 specs，避免 Vue 深度响应式化（与单型号一致）；rowNo 为结果集内原始行号
        this.filterResult = res.data.map((item, idx) => ({
          ...item,
          rowNo: idx + 1,
          specs: Object.freeze(item.specs || [])
        }));
        this.specSelectedRows = [];
        this.filterMultiStats = res.stats;

        if (res.maxReached) {
          this.$message.warning('结果达上限 2000，建议缩小输入');
        } else if (res.truncated) {
          this.$message.warning(`仅取前 200 行，共 ${res.data.length} 条结果`);
        } else {
          this.$message.success(`匹配完成，共 ${res.data.length} 条结果`);
        }

        this.$nextTick(() => this.calcTableHeight());
      } catch (err) {
        this.$message.error('查询失败: ' + err.message);
      } finally {
        this.filtering = false;
        this.loading = false;
      }
    },

    // 执行型号筛选
    async runFilter() {
      await this._invokeFilter(this.filterForm);
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
        // 多型号态：表头首列加"输入型号"，走 customHeaders 通用模式
        let payload;
        if (this.filterInputMode === 'multi') {
          const headers = ['输入型号', '命中产品数', '产品型号', '产品特点', '尺寸(Inch/mm)', '温度特性', '标称容量', '容量偏差', '额定电压(Vdc)'];
          payload = {
            outputPath: savePath,
            // 与表格所见一致：跟随系列筛选与搜索结果
            data: this.filteredFilterResult.map(item => ({
              '输入型号': item.inputName || '',
              '命中产品数': item.hitCount !== undefined ? item.hitCount : '',
              '产品型号': item.unmatched ? '未匹配' : (item.productName || ''),
              '产品特点': item.features || '',
              '尺寸(Inch/mm)': item.size || '',
              '温度特性': item.tempCharacteristics || '',
              '标称容量': item.capacity || '',
              '容量偏差': item.capacityDeviation || '',
              '额定电压(Vdc)': item.voltage || ''
            })),
            customHeaders: headers
          };
        } else {
          payload = {
            outputPath: savePath,
            data: this.filterResult
          };
        }

        const exportResult = await ipcRenderer.invoke('export-filter-excel', payload);

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

    // 切换强茂单/多型号输入模式：清空结果、统计与对方态输入
    toggleQmInputMode() {
      this.qmInputMode = this.qmInputMode === 'single' ? 'multi' : 'single';
      this.qmFilterResult = null;
      this.qmMultiStats = null;
      this.qmSearchText = '';
      if (this.qmInputMode === 'single') this.qmInputText = '';
      else this.qmSingleText = '';
    },

    // 强茂查询（单型号/多型号均直接查询）
    async runQmFilter() {
      // 按模式取输入型号列表
      let names;
      if (this.qmInputMode === 'single') {
        const text = (this.qmSingleText || '').trim();
        if (!text) { this.$message.warning('请输入产品型号'); return; }
        names = [text];
      } else {
        const text = (this.qmInputText || '').trim();
        if (!text) { this.$message.warning('请输入产品型号'); return; }
        names = splitInputLines(text, m => this.$message.warning(m));
        if (names.length === 0) { this.$message.warning('未识别到产品型号'); return; }
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

        // 构建型号索引（去空格，大写比较）
        const productMap = new Map();
        for (const item of products.list) {
          const pn = (item.partNumber || '').trim().toUpperCase();
          if (pn) productMap.set(pn, item);
        }

        // 精确匹配 + 模糊匹配（包含关系），按输入顺序汇总
        const results = [];
        let matchedInputs = 0;
        for (const name of names) {
          const pnKey = name.toUpperCase();
          let hit = false;
          if (productMap.has(pnKey)) {
            results.push(productMap.get(pnKey));
            hit = true;
          } else {
            for (const [key, item] of productMap) {
              if (key.includes(pnKey) || pnKey.includes(key)) {
                results.push(item);
                hit = true;
              }
            }
          }
          if (hit) matchedInputs++;
        }

        // rowNo 为结果集内原始行号（不随搜索重编号）；展开拷贝避免污染产品库对象
        this.qmFilterResult = results.map((item, idx) => ({ ...item, rowNo: idx + 1 }));
        if (this.qmInputMode === 'multi') {
          this.qmMultiStats = {
            totalInputs: names.length,
            matchedInputs,
            unmatchedInputs: names.length - matchedInputs,
            productCount: results.length
          };
        }

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

    // 强茂重置
    resetQmFilter() {
      this.qmSingleText = '';
      this.qmInputText = '';
      this.qmFilterResult = null;
      this.qmMultiStats = null;
      this.qmSearchText = '';
      this.$message.success('已重置');
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

    // ============ 大毅（电阻）型号换算 ============
    // 切换大毅单/多型号输入模式：清空结果与对方态输入
    toggleDyInputMode() {
      this.dyInputMode = this.dyInputMode === 'single' ? 'multi' : 'single';
      this.dyResult = null;
      this.dySearchText = '';
      this.dyStatusFilter = '';
      if (this.dyInputMode === 'single') this.dyInputText = '';
      else this.dySingleText = '';
    },

    // 换算查询（单型号/多型号均逐行调用 matcher-resistor.js 换算为大毅型号）
    runDyConvert() {
      // 按模式取输入型号列表
      let lines;
      if (this.dyInputMode === 'single') {
        const text = (this.dySingleText || '').trim();
        if (!text) { this.$message.warning('请输入他牌电阻型号'); return; }
        lines = [text];
      } else {
        const text = (this.dyInputText || '').trim();
        if (!text) { this.$message.warning('请输入他牌电阻型号'); return; }
        lines = splitInputLines(text, m => this.$message.warning(m));
        if (lines.length === 0) { this.$message.warning('未识别到型号'); return; }
      }

      this.dyParsing = true;
      try {
        const rows = lines.map((line, idx) => ({ ...this.convertOneResistor(line), rowNo: idx + 1 }));
        this.dyResult = rows;

        const ok = rows.filter(r => r.dayiModel).length;
        const fail = rows.length - ok;
        if (ok > 0 && fail > 0) {
          this.$message.success(`解析完成：${ok} 条已换算，${fail} 条未识别`);
        } else if (ok > 0) {
          this.$message.success(`解析完成：${ok} 条已换算`);
        } else {
          this.$message.warning(`解析完成：${fail} 条型号未能识别`);
        }
      } catch (err) {
        this.$message.error('解析失败: ' + err.message);
      } finally {
        this.dyParsing = false;
      }
    },

    // 单行换算：他牌型号 → 大毅结果行
    convertOneResistor(line) {
      const empty = {
        input: line,
        brand: '',
        brandLabel: '',
        dayiModel: null,
        dayiSeries: '',
        size: '',
        tol: '',
        resistanceFormatted: '',
        dayiResCode: '',
        error: null,
        note: ''
      };

      let r;
      try {
        r = resistorMatcher.matchResistorToDayi(line);
      } catch (err) {
        return { ...empty, error: '解析异常: ' + err.message };
      }

      if (!r || !r.ok) {
        return { ...empty, error: (r && r.error) || '无法识别厂家/格式' };
      }

      // 收集警告文案（warning 单条 + warnings 数组）
      const notes = [];
      if (r.warning) notes.push(r.warning);
      if (Array.isArray(r.warnings)) notes.push(...r.warnings);

      // 精度显示输出侧语义：0Ω jumper(Vishay Z) 已归一为大毅 J，表格应显示 ±5% 而非 "0Ω jumper"
      let tol = r.tol || '';
      if (r.dayiTolCode && r.dayiTolCode !== r.tolCode) {
        const mapped = resistorMatcher.TOL_MAP[r.dayiTolCode];
        if (mapped) {
          tol = mapped;
          notes.push(`容差 ${r.tolCode} 已归一为大毅 ${r.dayiTolCode}(${mapped})`);
        }
      }

      const row = {
        ...empty,
        brand: r.brand || '',
        brandLabel: RESISTOR_BRAND_LABEL[r.brand] || (r.brand || ''),
        dayiSeries: r.dayiSeries || '',
        size: r.size || '',
        tol,
        resistanceFormatted: r.resistanceFormatted || '',
        dayiResCode: r.dayiResCode || '',
        note: notes.join('；')
      };

      if (!r.dayiModel) {
        row.error = r.error || '缺少换算所需规格（封装/精度/系列）';
        return row;
      }

      row.dayiModel = r.dayiModel;
      return row;
    },

    // 清空大毅输入与结果
    clearDyResult() {
      this.dySingleText = '';
      this.dyInputText = '';
      this.dyResult = null;
      this.dySearchText = '';
      this.dyStatusFilter = '';
    },

    // 导出大毅换算结果
    async exportDyResult() {
      if (!this.dyResult || this.dyResult.length === 0) {
        this.$message.warning('没有可导出的数据');
        return;
      }

      const savePath = await ipcRenderer.invoke('save-file', '大毅电阻型号换算结果.xlsx');
      if (!savePath) return;

      this.loading = true;
      this.loadingText = '正在导出Excel...';

      try {
        const exportHeaders = ['输入型号', '厂家', '大毅型号', '大毅系列', '封装', '精度', '阻值', '阻值码', '备注'];
        const exportData = this.dyResult.map(item => ({
          '输入型号': item.input || '',
          '厂家': item.brandLabel || '',
          '大毅型号': item.dayiModel || '未识别',
          '大毅系列': item.dayiSeries || '',
          '封装': item.size || '',
          '精度': item.tol || '',
          '阻值': item.resistanceFormatted || '',
          '阻值码': item.dayiResCode || '',
          '备注': item.error || item.note || ''
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
      try {
        const result = await ipcRenderer.invoke('toggle-pin-window');
        this.isPinned = result.pinned;
      } catch (err) {
        this.$message.error('切换置顶失败: ' + err.message);
      }
    },

    // 获取当前置顶状态
    async getPinStatus() {
      try {
        const result = await ipcRenderer.invoke('get-pin-status');
        this.isPinned = result.pinned;
      } catch (err) {
        this.$message.error('获取置顶状态失败: ' + err.message);
      }
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

    // 规格书下载进度
    ipcRenderer.on('spec-dl-progress', (e, p) => {
      this.loadingText = p.total ? `正在下载规格书 ${p.done}/${p.total} ${p.name || ''}` : '正在下载规格书...';
    });
  }
});
