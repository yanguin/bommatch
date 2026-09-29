# PLAN.md — 执行步骤 / 每步验收

> 每个阶段完成后：先验证结果，再更新 STATUS.md。开启新对话前先读 PROJECT.md + PLAN.md + STATUS.md。

## 一、数据维护流程（已完成，记录标准步骤）
1. 拉取官网全量数据（输出到 `scripts/viiyong_products_full.json`）：
   ```bash
   node scripts/fetch_full.js
   ```
   - **验收**：日志尾部打印 `总数 N, 共 N 条`；`N` 为官网当前总数（2026-09-29 时为 22500）。
2. 覆盖正式数据：
   ```bash
   node -e "require('fs').copyFileSync('scripts/viiyong_products_full.json','data/viiyong_products_full.json')"
   ```
   - **验收**：`node -e "const d=require('./data/viiyong_products_full.json');console.log(d.total,d.list.length)"` 数量一致、无重复料号。
3. 更新数据前**先归档旧数据**到 `data/archive_YYYYMMDD/`（当前约定归档文件 `viiyong_products_full.json`），旧版本可从 git HEAD 提取。
4. 重建技能精简库（仓库外 `~/.trae-cn/skills/bommatch`）：
   ```bash
   cd ~/.trae-cn/skills/bommatch
   node scripts/build_data.js "c:/Users/yangu/Desktop/viiyong/bommatch/data/viiyong_products_full.json" "~/.trae-cn/skills/bommatch/data/viiyong_products.json"
   ```
   - **验收**：重建条数与 full 一致；抽样匹配正常。
5. 插件改动（`backup_and_fetch.js` / `move_to_data.js` / `.bat`）：按需微调，改前确认不影响现有流程。

## 二、构建流程（皇上自行执行，我不代跑打包）
- 首次/依赖变更后：`npm install`
- Windows 安装包：`npm run build:win`（electron-builder，产物在 `dist/`）
- 本机调试运行（不打包）：`npm run dev`
- 通用打包：`npm run build`
- **验收**：安装包出现在 `dist/`，本机可安装运行，能正确加载最新 `data/viiyong_products_full.json`（22500 条）。

## 三、代码修改流程
1. 读 PROJECT.md + PLAN.md + STATUS.md，读相关模块、调用方、共享工具。
2. 说明假设（输入/目标/边界），定义「完成」判据。
3. 外科手术式最小改动；同一件事两种模式时只挑一种。
4. 跑对应回归测试（见 PROJECT.md「完成标准」）。
5. 验证通过后更新 STATUS.md；开启新对话先读这 3 个文件。

## 四、当前阶段（下一阶段的执行步骤）
- 如需核对「官网下架的 10 条规格」，对比可用 `git show HEAD:data/viiyong_products_full.json` 与现版 diff。
- 如有解析/匹配逻辑改动，按「完成标准」跑回归并回写 STATUS.md。