# STATUS.md — 当前状态 / 失败方案 / 已知问题

## 已完成
- [x] 【功能】单型号筛选「标称容量 / 额定电压」新增**范围搜寻**（2026-10-27，皇上钦定方案一）：两字段标题行各加「精确/范围」迷你切换器（el-radio-button，主题色已对齐 var(--color-accent)）。范围模式=闭区间（含 from/to），边界留空=开区间，容量范围 from/to 两行**各自带单位下拉**（capacityUnit / capacityToUnit，后端各自换算成 pF；旧表单无 toUnit 字段回退共用 capacityUnit），电压固定 Vdc；from>to 查询前报错不悄悄交换；范围两端全空=该条件不筛选（有其他条件时直接按其他条件筛、不报错，2026-10-27 皇上圣裁），仅整张表单无任何条件时沿用「请至少设置一个筛选条件」防卡顿兜底（皇上圣裁保留）；解析回填（renderer.js parseSpec 填充处）时强制切回精确模式（皇上钦定）。改动：index.html（.filter-mode-row 样式 + 两段 UI）、renderer.js（filterForm 增 capacityMode/From/To/ToUnit、voltageMode/From/To，resetFilter 同步，回填置 exact）、main.js（hasCondition 增范围判断、容量/电压预处理与匹配双分支，exact 路径原样保留）。新增 `_test_range_filter.js` 20/20 PASS（闭区间含边界/开区间/报错/叠加/跨单位/旧表单兼容）；`_test_multi_filter.js` 32/32、`_test_dayi.js` 207/207 不回归；index.html Vue 模板编译通过。matcher-core.js 零改动，多型号路径不受影响。
- [x] 【版本】应用版本改为测试版 `1.4.7-alpha.1`（2026-10-27，皇上钦定保持 1.4.7 加测试标识）：只改 package.json + package-lock.json（两处同步）；`version.txt` 是 Gitee 远程授权拦截配置（duration/enabled），**未动**。界面标题自动跟随为 v1.4.7-alpha.1，产物命名 `BOM.Setup.1.4.7-alpha.1.exe`；semver 上 alpha < 正式版，正式用户不会被热更，alpha 用户可正常升到正式 1.4.7。
- [x] 【功能】「复制详细信息」模板化升级（2026-10-23）：复制格式 = 字段胶囊序列（tokens）+ 分隔符 + 风格开关；tokens 中 'ARROW' 为推导符「==》」。7 个内置预设（型号/规格[默认]、规格、规格==》型号、ERP反查、ERP全字段、原描述、型号/输入型号），「更多」菜单直接点选复制 + 悬停显示示例；「自定义复制格式…」弹窗支持胶囊增删/调序、分隔符(/,;|)、容值大写、SMD前缀、多行换行/Tab 分隔、实时预览、存为自定义预设（localStorage `bommatch_copy_cfg`，含上次使用记忆）。改动：renderer.js（COPY_BUILT_IN_PRESETS/COPY_FIELD_DEFS 常量 + copy* 方法组 + computed）、index.html（菜单项 + el-dialog）；旧 copySelectedDetails 已删除（被模板引擎取代）。回归：`node _test_copy_fmt.js` 11/11 PASS（6 预设输出与设计示例逐字一致 + 4 边界）；`node _test_tpl_compile.js` 模板编译通过。main.js / matcher-core.js 零改动。
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
- **测试期望值禁止脑内枚举**（2026-10-27 范围筛选测试 3 次算漏的根因）：7 档位 × 二十用例靠心算勾选，「夹在中间」的档位（P006 47nF/25V）和跨级换算（0.01uF=10nF）必漏。正确姿势：先手写**基准档位全表**（统一单位 pF/V），再用**独立实现**（不复用被测代码）的脚本逐用例推导期望、与手写期望比对——`_verify_range_expect.js` 即此用途，加新用例先跑它对基准。
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
- 范围搜寻 UI 效果（切换器排布、from/to 两行对齐）待皇上 `npm start` 实机过目；若嫌两行占高可再议单行压缩排布。
- 如需技能 CLI 也走该尺寸归一修复，同步 `~/.trae-cn/skills/bommatch/lib/matcher-core.js`（有待皇上确认是否需要）。
- 平时：每完成一阶段先验证结果，再更新本文件；新对话先读 PROJECT.md + PLAN.md + STATUS.md。