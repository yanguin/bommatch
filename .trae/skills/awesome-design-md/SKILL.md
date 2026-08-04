---
name: "awesome-design-md"
description: "Curated collection of DESIGN.md design-system docs from real websites (Stripe, Apple, Vercel, Linear, etc.). Invoke when user wants to generate UI, build pages, or apply a specific brand's visual style, or asks for design consistency / design language / design tokens."
---

# Awesome DESIGN.md

源自 VoltAgent 开源仓库 [awesome-design-md](https://github.com/VoltAgent/awesome-design-md)。
提供从真实网站提取的 `DESIGN.md` 设计系统文档集合，供 AI agent 读取后生成视觉一致的 UI。

## What is DESIGN.md?

`DESIGN.md` 是 Google Stitch 提出的纯文本设计系统文档。它就是一个 markdown 文件，放进项目根目录后，任何 AI 编码 agent 或 Google Stitch 都能立刻理解 UI 应有的外观与质感。无需 Figma 导出、JSON schema 或专用工具——Markdown 是 LLM 最擅长阅读的格式。

| 文件 | 谁来读 | 定义什么 |
|---|---|---|
| `AGENTS.md` | 编码 agent | 项目如何构建 |
| `DESIGN.md` | 设计 agent | 项目如何呈现（外观与质感） |

## When to Invoke

在以下场景触发本 skill：

- 用户要求"生成 UI / 构建页面 / 做一个像 XX 一样的界面"
- 用户希望应用某个品牌/网站的视觉风格（颜色、字体、组件、布局）
- 用户提到"设计语言 / 设计系统 / design tokens / 视觉一致性"
- 用户在 UI 任务中需要设计参考、配色、字体层级、组件样式规范

## How to Use

1. **选择目标设计**：从下方 Collection 中按需求挑选一个网站（例如做支付页选 Stripe，做开发者工具选 Vercel/Linear）。
2. **获取 DESIGN.md**：访问对应链接（形如 `https://getdesign.md/<site>/design-md`），将内容复制到项目根目录命名为 `DESIGN.md`；或直接在对话中引用其内容。
3. **让 AI 读取**：告知 AI agent "按照 DESIGN.md 构建 / 应用此设计系统"，生成保持视觉一致性的 UI。
4. **验证预览**：每个设计还附带 `preview.html` 与 `preview-dark.html`，可在浏览器中查看色板、字阶、按钮、卡片等样例。

## Collection (按类别)

### AI & LLM Platforms
- Claude — `https://getdesign.md/claude/design-md` 暖色陶土点缀、干净编辑式布局
- Cohere — 活力渐变、数据密集仪表盘美学
- ElevenLabs — 暗色电影感 UI、音频波形美学
- Minimax — 大胆暗色界面 + 霓虹点缀
- Mistral AI — 法式极简、紫色调
- Ollama — 终端优先、单色简约
- OpenCode AI — 开发者中心暗色主题
- Replicate — 纯白画布、代码优先
- Runway — 电影节编辑美学、暗色 hero + 纸白阅读区
- Together AI — 技术蓝图风格
- VoltAgent — 漆黑画布、翡翠绿点缀、终端原生
- xAI — 冷峻单色、未来极简

### Developer Tools & IDEs
- Cursor — 时尚暗色界面、渐变点缀
- Expo — 暗色主题、紧字距、代码中心
- Lovable — 活泼渐变、友好开发美学
- Raycast — 时尚暗色外观 + 活力渐变点缀
- Superhuman — 高端暗色 UI、键盘优先、紫色辉光
- Vercel — 黑白精准、Geist 字体
- Warp — 暗色 IDE 风格、块状命令 UI

### Backend, Database & DevOps
- ClickHouse — 黄色点缀、技术文档风格
- Composio — 现代暗色 + 彩色集成图标
- HashiCorp — 企业级干净、黑白
- MongoDB — 绿叶品牌、开发者文档导向
- PostHog — 俏皮刺猬品牌、开发者友好暗色 UI
- Sanity — 暗色编辑表面、112px 标题、IBM Plex Mono、珊瑚红 CTA
- Sentry — 暗色仪表盘、数据密集、粉紫点缀
- Supabase — 暗色翡翠主题、代码优先

### Productivity & SaaS
- Cal.com — 干净中性 UI、开发者向简约
- Intercom — 友好蓝色、对话式 UI
- Linear — 超极简、精准、紫色点缀
- Mintlify — 干净、绿色点缀、阅读优化
- Notion — 暖色极简、衬线标题、柔和表面
- Resend — 极简暗色、等宽点缀
- Zapier — 暖橙色、插画驱动

### Design & Creative Tools
- Airtable — 彩色友好、结构化数据美学
- Clay — 有机形状、柔和渐变、艺术指导布局
- Figma — 鲜活多色、俏皮而专业
- Framer — 大胆黑蓝、动效优先
- Miro — 明亮黄色点缀、无限画布美学
- Webflow — 蓝色点缀、精致营销站美学

### Fintech & Crypto
- Binance — 单色上的 Binance 黄、交易厅紧迫感
- Coinbase — 干净蓝色、信任导向、机构感
- Kraken — 紫色点缀暗色 UI、数据密集仪表盘
- Mastercard — 暖奶油画布、轨道药丸形、编辑温度
- Revolut — 时尚暗色界面、渐变卡片、金融科技精准
- Stripe — 标志性紫色渐变、weight-300 优雅
- Wise — 明亮绿色点缀、友好清晰

### E-commerce & Retail
- Airbnb — 暖珊瑚点缀、摄影驱动、圆角 UI
- Meta — 摄影优先、明/暗双表面、Meta 蓝 CTA
- Nike — 单色 UI、巨大无衬线 Futura、全出血摄影
- Shopify — 暗色电影感、霓虹绿点缀、超细显示字
- Starbucks — 四级大地绿系统、暖奶油画布、SoDoSans 字体

### Media & Consumer Tech
- Apple — 高端留白、SF Pro、电影级图像
- HP — 纯白画布、HP 电光蓝 CTA、Forma DJR Micro 几何字
- IBM — Carbon 设计系统、结构化蓝色
- NVIDIA — 绿黑能量、技术力量美学
- Pinterest — 红色点缀、瀑布流网格、图像优先
- PlayStation — 三表面通道布局、青色悬停缩放交互
- SpaceX — 冷峻黑白、全出血图像、未来感
- Spotify — 暗色上的活力绿、粗体字、专辑艺术驱动
- The Verge — 酸薄荷与紫外点缀、Manuka 显示字
- Uber — 大胆黑白、紧字距、都市能量
- Vodafone — 巨型大写显示、Vodafone 红章节带
- WIRED — 纸白宽版密度、定制衬线、墨蓝链接

### Automotive
- BMW — 暗色高端表面、精密德式工程美学
- BMW M — 赛车风对比、M 色点缀、精密驱动布局
- Bugatti — 影院黑画布、单色 austerity、纪念碑式显示字
- Ferrari — 明暗对比黑白编辑、Ferrari 红 + 极度稀疏
- Lamborghini — 真黑教堂、金色点缀、LamboType 定制新怪诞体
- Renault — 鲜活极光渐变、NouvelR 专有字、零圆角按钮
- Tesla — 激进减法、电影级全视口摄影、Universal Sans

### Retro Web · 怀旧系列
- Dell (1996) — 目录时代企业网、黑页框、色块"缎带卡片"
- Nintendo.com (2001) — Y2K"主机铬合金"网、刷纹金属面板、琥珀发光碳导航

## What's Inside Each DESIGN.md

每个文件遵循 [Stitch DESIGN.md 规范](https://stitch.withgoogle.com/docs/design-md/specification/)，含扩展章节：

| # | 章节 | 捕获内容 |
|---|---|---|
| 1 | Visual Theme & Atmosphere | 氛围、密度、设计哲学 |
| 2 | Color Palette & Roles | 语义名 + hex + 功能角色 |
| 3 | Typography Rules | 字体族、完整层级表 |
| 4 | Component Stylings | 按钮、卡片、输入、导航及状态 |
| 5 | Layout Principles | 间距比例、栅格、留白哲学 |
| 6 | Depth & Elevation | 阴影系统、表面层级 |
| 7 | Do's and Don'ts | 设计护栏与反模式 |
| 8 | Responsive Behavior | 断点、触控目标、折叠策略 |
| 9 | Agent Prompt Guide | 快速色板参考、即用提示 |

每个站点还附：
- `preview.html` — 色板、字阶、按钮、卡片可视化目录
- `preview-dark.html` — 同目录的暗色表面版本

## Workflow Example

用户："帮我做一个像 Stripe 那样的支付页"
1. 拉取 `https://getdesign.md/stripe/design-md` 的 DESIGN.md
2. 写入项目根目录 `DESIGN.md`
3. 读取并应用其色板（紫色渐变）、字体（weight-300 优雅）、组件样式（按钮/卡片/输入）
4. 按 Layout Principles 与 Responsive Behavior 生成页面
5. 对照 Do's and Don'ts 自检视觉一致性

## Source
- 仓库：https://github.com/VoltAgent/awesome-design-md
- 协议：MIT License
