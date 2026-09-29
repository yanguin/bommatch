# STATUS.md — 当前状态 / 失败方案 / 已知问题

## 已完成
- [x] 【功能】型号筛选单型号输入框下方新增「实时厂商提示」：`matcher-core.detectBrand`（型号→厂商，规格描述/空→不显示；歧义前缀按皇上口径以"或"显示双名：MT→PDC信昌|Walsin华新科、4位数字+介质→FH风华|Walsin华新科、微容最后判断）。renderer 新增 computed `filterBrandHint`，html 输入框下加标签行。
- [x] 微容型号「解析与查询」尺寸键不一致 bug：`matchSpec` 用 `sizeInch()` 归一（项目 + 技能各地一版本，2026-09-29）。回归：multi_filter 32/0、dayi 207/0 全过。
- [x] 微容数据同步至官网最新状态：`data/viiyong_products_full.json` 22510 → **22500 条**（2026-09-29 拉取）。
- [x] 旧数据 22510 归档至 `data/archive_20260929/viiyong_products_full.json`。
- [x] 技能精简库 `~/.trae-cn/skills/bommatch/data/viiyong_products.json` 重建为 22500 条。
- [x] 数据提交并推送远程：commit `9deea53`，gitee `origin/master`。
- [x] 官网本次**纯下架** 10 条、无新增（对比 git HEAD）：
  - 1210/X7S/22µF ±20%（N3Z）：T/A 系列 × 25V、16V、10V 共 6 条
  - 0402/X7T·X7S/2.2µF/4V（NCT，T 系列）：±20% 与 ±10% 共 4 条

## 进处理中
- （当前无进行中任务）

## 失败方案 / 教训
- 直接覆盖 `data/viiyong_products_full.json` 前应走归档（`backup_and_fetch` / `move_to_data`）。本次未归档即覆盖，幸靠 git HEAD 恢复旧版，务必先归档。
- `git show HEAD:文件` 取大 JSON 时，`spawnSync/execSync` 默认缓冲会溢出（ENOBUFS），须加 `maxBuffer`（如 80MB）或落盘再读。
- PowerShell 里 `@{u}`（upstream 引用）会被当作哈希字面量报错，git 命令尽量单独拆开跑。

## 已解决
- [x] 微容型号「解析与查询」尺寸键不一致 bug：`matchSpec` 现用 `sizeInch(spec.size)` 归一（对齐索引的裸英制码），`A107M1210X7T4R0N3Z` 等微容自格式型号已能**精确匹配**（2026-09-29）。回归：multi_filter 32/0、dayi 207/0 全过。

## 已知问题
- （当前无未解决已知问题）
- 备注：技能目录 `~/.trae-cn/skills/bommatch/lib/matcher-core.js` 仍为旧逻辑、未做此尺寸归一修复；技能 CLI 若需同样行为，需同步该处。
- 官网下架后，上述 10 条规格当前库中无对应（同规格直接删除，无替代）。

## 下一步
- 如需技能 CLI 也走该尺寸归一修复，同步 `~/.trae-cn/skills/bommatch/lib/matcher-core.js`（有待皇上确认是否需要）。
- 平时：每完成一阶段先验证结果，再更新本文件；新对话先读 PROJECT.md + PLAN.md + STATUS.md。