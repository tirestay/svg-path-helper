# AGENTS.md — svgtool

面向后续 AI/开发者的约定。先读本文件，再看 `README.md`（面向用户的特性说明）。
本文件只写**读代码/README 看不出、但对改对任务至关重要**的约束与坑。

---

## 1. 项目形态与硬约束

- 单一 git 仓库，代码/文档直接放仓库根（无 `ref/`、无 `src/`、无 `dist/`、无同步工作流）。
- `index.html` 是**唯一交付物**：单文件、零构建、零 npm 依赖，运行时依赖只有 CDN
  （`cdn.tailwindcss.com` + FontAwesome 6）。不要引入构建工具、不要拆分文件。
- 两个 `<script>` 块：脚本 1 = 路径编辑器（`state`/`renderCanvas()`/`PRESETS` 等）；
  脚本 2 = 调试器（`const DBG` 纯逻辑 IIFE + `PART C` DOM 交互 IIFE）。
- **必须保持 classic script，严禁改成 `type="module"`**：调试器依赖"顶层 `const` 构成词法全局
  绑定、可跨 `<script>` 访问"读取脚本 1 的 `state`/`renderCanvas`。改成 module 会静默让调试器失效。
- 新代码沿用"**纯逻辑 IIFE + DOM IIFE**"双层划分：纯逻辑层绝不碰 `document`，`dbg.test.mjs` 才能
  把它抽出来在 Node 里跑。这是本项目最重要的一条可测试性约束。

## 2. 核心架构不变量（改交互前必须守住）

- **单一真源**：`dbgSource` 文本 ↔ `state.commands` 节点是同一份数据，没有"检查/编辑"两套视图。
  `applySource(rebuild, beep, keepView)` 是唯一入口：`rebuild=true`（文本/预设/⌘Enter/命令表编辑）
  解析后 `toCommands()` 重建节点；`rebuild=false`（编辑器交互回写）**只刷新、绝不重建节点**，否则打断拖拽。
- **`toCommands()` 是唯一允许写 `state.commands` 的地方**（A→三次贝塞尔、S→C、T→Q、H/V→L）。
- **回写靠包装 `renderCanvas`**（PART C 末尾把全局 `renderCanvas` 换成 `rawRenderCanvas +
  compensate + 回写 d 源`）。编辑器的所有变更出口都走 `renderCanvas`，只此一处。`ui.syncing` 是防重入
  门闩：`applySource(rebuild=true)` 期间为 true，包装层看到它就只渲染不回写——**漏了会死循环**（回写
  再触发解析）。`compensate()` 必须排在 `rawRenderCanvas()` 之后。此层无法 Node 单测，改后必跑浏览器冒烟。
- **有语法错误时不回写**（`ui.result.error` 存在），否则会用有效前缀覆盖用户尚未改完的原文。
- **一切触发走 `schedule()` 防抖 ~160ms**：一次拖动产生几十次 `renderCanvas`，逐次全量求积会掉帧。
- **预设走捕获阶段拦截**（`capture=true` + `preventDefault + stopPropagation`）抢在脚本 1 每个
  `.preset-btn` 自身处理器之前把路径写进 d 源。改成冒泡阶段会导致"点预设后节点被覆盖两次"。同理
  `gridVisibleCheck` 的 `applyChrome` 必须在脚本 1 处理器之后注册。
- **取景收口**：任何直改 viewBox **尺寸**的新代码都必须走 `setView(box)`（内部写 `ui.unit/ui.zoom` +
  `applyChrome` + `drawActive`），不要旁路只 `setAttribute`，否则图元补偿与叠加层半径（依赖 `U()`）滞后。
  只改 x/y 不改尺寸的平移（画布 pan）除外。
- **手动取景保护**：`ui.autoView` 记录最近一次取景写入的 `viewKey`。缩放/滚轮/pan 使当前取景 ≠
  `autoView` 后，`force=false` 的编辑器交互越界**不再重取景**（放大就是为了精确拖拽个别点）。只有文本/
  预设驱动的 `force=true`（含「适配当前窗口」）才重取景。**撤销/重做与命令表编辑必须传 `keepView=true`**
  ——恢复内容但保持当前视口，漏传会把用户放大的视图拉回自适应大小（历史回归）。
- **叠加层只画诊断**（高亮/反射菱形/圆弧/编号），锚点由编辑器画、**不在叠加层重画**。`drawActive()`
  是唯一叠加绘制入口（内部先 `clear(overlay)+clear(underlay)` 全量重绘、末尾统一 `renderDetail()`），
  调用方**不要再补** renderDetail/drawActive。
- **叠加开关作用域**：每项独立驱动一层 `segs.forEach`，用 `emph(seg)=o.all || seg===cur` 决定淡/强，
  `cur` 只用于额外高亮，**不要拿 `cur` 当渲染前提**（否则"不先选中段就点框没反应"会重现）。
- **选中态优先级：悬停 > 钉住**（`effIndex()` = `ui.active>=0 ? ui.active : ui.pinned`）。画布↔命令表
  双向联动，新增画布监听要复用 `effIndex` 语义、经 `markRows`，不要旁路。
- **追增/删除都走同源模型**（改数据）；缩放/滚轮/网格开关只改 viewBox（不改数据）。五枚 `.dbg-add-btn`
  中 `Z`（闭合）无需落点、直接 `insertClose()`，其余进 `pendingAdd` 待点选。`pendingAdd` 是 PART C 内
  `let`，声明必须在首屏 `applySource(true,false)` 之前（否则 `cancelPendingAdd()` 踩 TDZ）。
- **新画布浮层的布局守约**：三个既有浮层（右上 `dbgHistoryPanel`、右下 `dbgZoomButtons`、下中
  `dbgOverlayPanel`）都在 `canvasWrapper` 内、`mainSvg` 外，绝对定位、互不干扰拖拽/平移/点选段。新增画布
  浮层请放同一层，沿用这套定位，不要落进 `mainSvg` 内被叠加层 `clear()` 波及，也不要旁压既有三浮层位置。
- **弧长等指标只在 `applySource` 内经 `DBG.metricsOf` 算一次**，挂 `r.metrics` 供摘要/命令表/明细共用；
  新增指标挂到 `r.metrics`，不要就地重算。
- **历史栈不变量**（`hi` 栈，采集点是 `applySource` 尾部的 `pushHistory()`）：同一文本不重复入条，
  去重比对项必须是**游标所指 `entries[hi.index]`（当前状态）而非栈顶**——回看历史时栈顶是"未来"，若比栈顶
  会把刚撤销的条目误删并重写成重复条（undo 后计数不变、redo 回不去）；游标非栈顶且内容变化才算真分叉、
  才截断。**短路 return 只跳过入栈，不跳过 `renderHistory()` 刷新面板**（游标已由 `historyGoto` 移动）。
  同名且 700ms 内归并（防抖拆条），cap 60 丢最旧。
- **面板固定显示后，"空数据就早退不刷新"会造成残留**：如 `drawActive()` 零段早退仍须
  `renderDetail()`，否则清空 d 源时线段明细停在上一条。改这类早退前先问：有人依赖它的副作用（清空/占位）吗？
- **圆弧不可逆**：一旦画布发生过编辑器交互，d 源会被回写成节点展开后的形式，A/S/T/H/V 信息丢失
  （A→C 近似）；这是同源模型的必然结果，不要试图"修复"。要保留原文就只改文本、不要拖节点。

## 3. 三个格式化函数（勿混用）

| 函数 | 精度 | 用途 |
|---|---|---|
| `DBG.fmt(v, prec)` | 用户可选 `'full'`（默认不取整）或 0–6 | **路径数据**（normalize 输出），会被浏览器再解析 |
| `fc(v)=DBG.fmt(v,2)` | 固定 2 位 | 仅**面板文字展示** |
| `fv(v)` | 自适应 2/4/8 位 | **视图量**：viewBox、标记半径、字号、rotate() 参数 |

`fv` 存在的原因：**viewBox 宽或高为 `0` 会直接禁用整个 `<svg>` 渲染**，小路径用 2 位小数会被舍成 `0`。
`DBG` 对外接口以脚本 2 里 DBG IIFE 的返回对象为准（parsePath/normalize/metricsOf/boundsOf/viewBoxOf/
zoomBox/rotPt/arcSolve/segPoint/segDeriv/segLength/arcToCubics/fmt 等），不必在此罗列签名。

## 4. 验证流程（改完必须跑，均在仓库根）

```bash
node dbg.test.mjs        # 回归门禁：从 index.html 就地抽取 DBG 纯逻辑层用 Node 跑
```

语法自检（确认两个脚本块仍可解析、没写坏 `</script>`）：

```bash
node -e "const fs=require('fs');const h=fs.readFileSync('index.html','utf8');\
[...h.matchAll(/<script>([\s\S]*?)<\/script>/g)].forEach((m,i)=>{try{new Function(m[1]);\
console.log('script',i+1,'OK')}catch(e){console.log('script',i+1,'ERR',e.message)}})"
```

浏览器冒烟（自动化打不开 `file://`，必须起静态服务）：

```bash
python3 -m http.server 8765 --bind 127.0.0.1   # 访问 http://127.0.0.1:8765/index.html
```

- **抽取锚点唯一性（真实踩过的坑）**：`dbg.test.mjs` 用
  `html.indexOf('const DBG = (function () {')` + 首个行首缩进 `})();` 从 index.html 抽逻辑层。
  **任何注释或文案都不得原样复述这行锚点文本**（哪怕带引号），否则 `indexOf` 命中注释 → 抽错起点 →
  Node 里 SyntaxError → 门禁整体崩溃。描述它时改写措辞。
- DOM 层（§2 的同步/取景/拦截/占位）**无自动化门禁**，改动后必须跑一次浏览器冒烟。
- 已知自动化限制：浏览器工具无法驱动原生 `<select>` 弹窗。判定"不可用"前先用单测覆盖逻辑。

## 5. 沟通与提交

- 注释、面向用户文案、文档一律**中文**；标识符与 SVG/规范术语保持英文原文。
- 不主动提交、不主动建文档文件；`README.md` 只在功能面向用户可见时更新。
- 本仓库只有一条 `main` 分支，工作区可能有用户未提交的其他改动，**不要顺手回滚别人的改动**。

## 6. 算法依据

解析/几何/规范化依据 W3C SVG 2《Paths》+ 附录 F.6.5（端点参数 ↔ 圆心参数）等公开规范实现，不依赖闭源
代码。功能形态与文案以本仓库 `index.html`、`README.md` 为准，新增功能沿用现有交互与文案风格。
