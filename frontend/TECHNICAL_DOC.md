# MMFold 2.0 Demo Frontend — 技术文档

> 版本：Demo 1.0  
> 更新日期：2026-05-07  
> 技术栈：React 19 + Vite 8 + Mol\* 5.8（无 UI 库、无路由库、无状态管理库）

---

## 目录

1. [项目概览](#一项目概览)
2. [技术架构](#二技术架构)
3. [页面路由与全局状态](#三页面路由与全局状态)
4. [首页（HomePage）](#四首页homepage)
5. [结果页总览与布局](#五结果页总览与布局)
6. [3D 分子查看器（MolstarViewer）](#六3d-分子查看器molstarviewer)
7. [互作 SVG Overlay](#七互作-svg-overlay)
8. [非共价相互作用计算引擎（interactionAnalyzer）](#八非共价相互作用计算引擎interactionanalyzer)
9. [互作数据面板（InteractionsCard）](#九互作数据面板interactionscard)
10. [2D 互作图](#十2d-互作图)
11. [抗体编号方案与 Annotations](#十一抗体编号方案与-annotations)
12. [Liability 扫描器](#十二liability-扫描器)
13. [同源蛋白叠加（Superimpose）](#十三同源蛋白叠加superimpose)
14. [PAE 热图](#十四pae-热图)
15. [序列条（SequenceBar）](#十五序列条sequencebar)
16. [3D Viewer 工具栏与图例系统](#十六3d-viewer-工具栏与图例系统)
17. [全局残基联动机制](#十七全局残基联动机制)
18. [数据规范](#十八数据规范)
19. [构建与运行](#十九构建与运行)
20. [已知限制与后续方向](#二十已知限制与后续方向)

---

## 一、项目概览

MMFold 2.0 Demo 是一个蛋白质结构预测结果展示平台，支持两种任务类型：

| 任务类型 | 输入 | 核心分析 |
|---------|------|---------|
| **酶-小分子 Docking** | 蛋白序列 + 配体 SMILES | 酶-配体非共价相互作用、配体 2D 拓扑图 |
| **抗体-抗原结构预测** | 抗原序列 + 重链 + 轻链 | 抗体-抗原界面互作、CDR 注释（5 种编号方案）、序列 Liability 扫描 |

前端为纯静态 SPA，所有预测数据以 JSON/PDB 文件形式存放于 `public/` 目录，无后端 API 依赖。

---

## 二、技术架构

### 2.1 技术选型

| 层 | 选型 | 说明 |
|---|------|-----|
| 框架 | React 19 | 函数式组件 + Hooks（useState/useEffect/useMemo/useRef） |
| 构建 | Vite 8 | 开发热更新 + 生产构建，`@vitejs/plugin-react` |
| 3D 可视化 | Mol\* 5.8 | WebGL 分子结构渲染引擎，通过 `dynamic import()` 延迟加载 |
| 2D 可视化 | 原生 SVG | 手写 React/SVG 组件，无图表库依赖 |
| 路由 | 内存状态机 | `App.jsx` 中 `currentPage` 二态切换，无 URL 变化 |
| 样式 | 原生 CSS | 暗色主题（`#0d0d0d` 背景），无 CSS-in-JS / 预处理器 |

### 2.2 源文件清单

```
src/
├── App.jsx                    # 路由入口（19 行）
├── HomePage.jsx               # 任务提交页（567 行）
├── ResultPage.jsx             # 结果展示页（2197 行）— 核心文件
├── MolstarViewer.jsx          # 3D 分子查看器（959 行）
├── PAECanvas.jsx              # PAE 热图交互画布（298 行）
├── interactionAnalyzer.js     # 非共价相互作用计算引擎（497 行）
├── liabilityScanner.js        # 抗体序列 Liability 扫描器（106 行）
├── fetchHomologs.js           # RCSB 同源蛋白搜索（60 行）
├── AppHeader.jsx              # 站点顶栏（23 行）
├── ResultPage.css             # 结果页样式（1741 行）
├── HomePage.css               # 首页样式（669 行）
├── App.css / index.css        # 全局样式
└── main.jsx                   # createRoot 入口（10 行）
```

### 2.3 `public/` 数据目录

```
public/
├── 酶-小分子docking/              # 酶任务示例
├── 抗体结构预测-新/                # 抗体任务示例
├── 抗体抗原结构预测/               # 抗体-抗原任务示例
├── homologs/                     # 同源蛋白 CIF 结构文件
│   ├── enzyme/                   #   5XFZ, 5XG0, 5XH2, 7CY0, 7XTW
│   ├── antibody/                 #   7S4S, 7ZCE, 7ZF3, 8GC1, 8UT3
│   └── antibody-new/             #   2ZCH, 2ZCK, 2ZCL, 4NFE, 4NFF
├── favicon.svg / logo.svg / icons.svg
```

每个任务目录包含完整数据集（详见[数据规范](#十八数据规范)章节）。

---

## 三、页面路由与全局状态

### 3.1 路由机制

`App.jsx` 实现一个两态内存状态机，**无 URL 变化、无浏览器历史记录、无深链接**：

```
state: currentPage = 'home' | 'result'
state: selectedTask = { type, name, folder?, ... }
```

- 默认渲染 `<HomePage />`
- 用户点击已完成任务 → `onViewResult(task)` → 设置 `selectedTask`，切换 `currentPage = 'result'`
- 结果页点击 Back → `currentPage = 'home'`

### 3.2 任务数据解析

`ResultPage` 接收 `task` prop，通过 `FOLDERS` 映射确定数据目录：

```js
const FOLDERS = {
  enzyme: '酶-小分子docking',
  antibody: '抗体抗原结构预测',
}
const folder = task?.folder ?? FOLDERS[task?.type] ?? FOLDERS.enzyme
```

`task.folder` 可直接指定目录（用于特殊示例），否则按 `task.type` 映射。

---

## 四、首页（HomePage）

### 4.1 功能概述

任务提交页面，包含序列输入、实体管理、文件导入、提交预览、历史记录五个模块。

### 4.2 子组件

| 组件 | 位置 | 功能 |
|------|------|------|
| `QuickPaste` | ~L93 | FASTA/纯序列粘贴区，支持 FASTA 和 JSON 文件导入 |
| `EntityCard` | ~L153 | 单个实体卡片：类型选择器（protein/DNA/RNA/ion/ligand）、拷贝数、序列 textarea、折叠/删除 |
| `ImportButton` | ~L221 | 下拉导入按钮，FASTA / JSON 两种文件格式 |
| `JobPreviewModal` | ~L268 | 提交前预览弹窗：实体汇总表格、任务名、种子设置 toggle |
| `JobHistory` | ~L354 | 任务历史列表：状态筛选 chips（RUNNING/COMPLETED/FAILED）、文本搜索、分页（10/25/50 条）、多选、ID 复制 |

### 4.3 序列解析逻辑

提供四个工具函数处理用户输入：

| 函数 | 输入 | 逻辑 |
|------|------|------|
| `parseFasta(text)` | FASTA 格式文本 | 按 `>header` 分割，提取序列名和序列体 |
| `parsePlainSequences(text)` | 纯序列文本 | 按空行分割为多条序列 |
| `parseJson(text)` | JSON 文本 | 解析实体数组 |
| `inferSequenceType(seq)` | 单条序列 | 通过字母表判断：仅含 ATCG → DNA，含 U → RNA，其余 → protein |

### 4.4 模拟提交行为

前端模拟后端响应（demo 无真实后端）：

1. 用户点击提交 → 创建 `status: 'RUNNING'` 任务
2. `setTimeout` 随机 2~3.5 秒后，将状态切换为 `COMPLETED`
3. 点击已完成任务行 → 调用 `onViewResult(task)` 进入结果页

---

## 五、结果页总览与布局

### 5.1 页面结构

`ResultPage`（~L60，2197 行）是整个应用的核心组件，管理 26+ 个 state 变量。

**布局采用 CSS Grid 双栏：**

```
┌──────────────────────────────────────────────┐
│              Sample 1-5 Tabs                 │
├──────────────┬───────────────────────────────┤
│ ipTM / pTM   │     MOS CTA button           │
├──────────────┼───────────────────────────────┤
│              │  Annotations                  │
│  3D Viewer   │  Non-Covalent Bond            │
│  (sticky)    │  Liability Scan (抗体模式)     │
│              │  Homologs                     │
│  SequenceBar │  Information                  │
├──────────────┴───────────────────────────────┤
│             PAE Heatmap                      │
└──────────────────────────────────────────────┘
```

- **左栏**：`position: sticky`，包含 3D Viewer + 工具栏/图例 + SequenceBar
- **右栏**：可滚动，包含 5 个数据面板
- **底部**：PAE 热图，跨双栏

### 5.2 核心状态变量

```js
// 样本选择
activeSample          // 0-4，当前查看的 sample 索引
summaries             // 5 个 sample 的置信度摘要
fullData              // 当前 sample 的完整 PAE 矩阵

// 注释
annotations           // annotations.json 解析结果
activeScheme          // 当前编号方案 'IMGT' | 'Kabat' | 'EU' | 'AHo' | 'ANARCI'
selectedGroupIds      // Set<string>，多选中的注释分组 ID

// 残基焦点
focusedResidues       // [{chain, seqId, resType}, ...]，多选残基数组
hoveredGroupId        // 鼠标悬停的注释分组 ID
hoveredIxResidue      // 互作表格 hover 的残基

// 互作
interactions          // 计算结果 { hBonds, piPiStacks, piCations, saltBridges, hydrophobics }
interactionsLoading   // boolean

// 同源蛋白
homologs              // homologs.json 数组
superimposeId         // 当前叠加的 PDB ID

// 查看器
reprMode              // 'cartoon' | 'surface'
colorMode             // 'plddt' | 'electrostatic'

// Liability
liabilityHits         // 扫描命中数组
liabilityOpen         // Set<string>，展开的分组名
```

### 5.3 数据加载时序

页面挂载时，通过 6 个独立的 `useEffect` 并行加载数据：

```
mount / folder 变化
  ├→ useEffect: 加载 5 个 summary_confidences JSON（并行 Promise.all）
  ├→ useEffect: 加载 annotations.json
  ├→ useEffect: 加载 information.json
  ├→ useEffect: 加载 homologs.json
  └→ useEffect: 加载 confidences_{sample}.json（随 activeSample 变化）

information 加载完成
  └→ useEffect: 调用 scanEntities() 执行 Liability 扫描

information + activeSample 变化
  └→ useEffect: 调用 analyzeInteractions() 或 analyzeProteinProteinInteractions()
                 从 PDB 文件计算非共价互作
```

### 5.4 抗体/抗原链识别

通过 `information.entities` 的 `label` 字段区分：

```js
const { abChains, agChains } = useMemo(() => {
  for (const e of information.entities) {
    const lbl = (e.label || '').toLowerCase()
    if (lbl.includes('heavy') || lbl.includes('light')) ab.push(e.chain)
    else if (lbl.includes('antigen')) ag.push(e.chain)
  }
  return { abChains: ab, agChains: ag }
}, [taskType, information])
```

这两个链组后续传递给互作计算引擎和 2D 图组件。

---

## 六、3D 分子查看器（MolstarViewer）

### 6.1 Props 接口

```typescript
interface MolstarViewerProps {
  structureUrl: string           // PDB 文件 URL，变化时完全重新初始化 plugin
  highlightedResidues: Residue[] // 选中高亮的残基数组
  focusedResidue: Residue        // 单个聚焦残基（相机飞入 + 显示互作标注）
  representationMode: 'cartoon' | 'surface'
  taskType: 'enzyme' | 'antibody'
  superimposeUrl: string         // 同源蛋白 CIF/PDB URL
  onResidueClick: (residue) => void
  colorMode: 'plddt' | 'electrostatic'
  autoFocusLigand: boolean       // 酶模式自动聚焦配体
  interactions: InteractionsData // 预计算的互作数据，用于 SVG overlay
}
```

### 6.2 初始化流程

`useEffect([structureUrl])` 控制完整生命周期：

```
1. 创建容器 div，append 到 parentRef
2. dynamic import Mol* 模块（createPluginUI, renderReact18, DefaultPluginUISpec）
3. 创建 plugin 实例，配置：
   - 隐藏所有原生 UI 控件（showControls: false）
   - 隐藏坐标轴（axes: 'off'）
   - viewport controls 替换为空组件 NoopControls
4. 下载并解析 PDB 文件 → trajectory → hierarchy.applyPreset('default')
5. 设置背景色为 #1a1d24
6. 注册 pLDDT 自定义主题
7. 注册 Electrostatic 自定义主题
8. 应用初始表示模式
9. 订阅 click 事件（提取 auth_asym_id + auth_seq_id + auth_comp_id）
10. cleanup: plugin.dispose() + 移除容器
```

### 6.3 pLDDT 自定义着色主题

通过 Mol\* 的 `CustomElementProperty` API 实现：

```js
CustomElementProperty.create({
  label: 'Custom pLDDT Confidence',
  name: 'custom-plddt-confidence',
  getData(model) {
    // 遍历所有原子，读取 B_iso_or_equiv (B-factor) 列
    // B-factor 在 AlphaFold PDB 中存储 pLDDT 值
    const bFactors = model.atomicConformation.B_iso_or_equiv.value
    for (let i = 0; i < n; i++) map.set(i, bFactors(i))
  },
  coloring: {
    getColor(v) {
      if (v > 90) return Color(0x0066cc)   // 深蓝 — Very High
      if (v > 70) return Color(0x4dd8e8)   // 青色 — Confident
      if (v > 50) return Color(0xffdd57)   // 黄色 — Low
      return Color(0xff9933)               // 橙色 — Very Low
    }
  }
})
```

注册后通过 `plugin.representation.structure.themes.colorThemeRegistry.add()` 注入到 Mol\* 主题系统，通过 `plugin.customModelProperties.register()` 注册属性提供器。

### 6.4 Electrostatic 自定义着色主题

基于氨基酸残基的电荷分配表：

```js
const RESIDUE_CHARGE = {
  ARG: 1.0, LYS: 1.0, HIS: 0.5,      // 正电荷
  ASP: -1.0, GLU: -1.0,                // 负电荷
  ASN: -0.3, GLN: -0.3,                // 弱负
  SER: -0.15, THR: -0.15, TYR: -0.2,   // 弱负
  ALA: 0, VAL: 0, LEU: 0, ...          // 中性
}
```

颜色映射为红-白-蓝连续渐变：
- 负电荷 → 红色 `#e74c3c`
- 中性 → 白色 `#ffffff`
- 正电荷 → 蓝色 `#3498db`

RGB 分量通过线性插值计算：
```js
getColor(v) {
  const c = clamp(v, -1, 1)
  if (c < 0) {  // 负→白 插值
    r = lerp(0xe7, 0xff, 1+c)
    g = lerp(0x4c, 0xff, 1+c)
    b = lerp(0x3c, 0xff, 1+c)
  } else {      // 白→正 插值
    r = lerp(0xff, 0x34, c)
    g = lerp(0xff, 0x98, c)
    b = lerp(0xff, 0xdb, c)
  }
}
```

### 6.5 表示模式切换

`applyRepresentationMode(plugin, mode, taskType, colorMode)` 函数处理三种场景：

**Cartoon 模式（通用）：**
- 遍历所有 structure components
- 根据 component label 判断类型：polymer → cartoon，ligand/ion/water → ball-and-stick
- 通过 `replaceRepresentation()` 先移除旧 representation，再添加新的

**Surface 模式 — 酶任务：**
- polymer 组件替换为 `molecular-surface`
- ligand/ion 保持不变

**Surface 模式 — 抗体任务（`applyAntibodySurface`）：**
核心需求是将抗体链和抗原链分别渲染为独立表面，实现视觉上的区分：

```
1. 检查是否已经拆分过（通过 component label 包含 'Antibody' 判断）
2. 如果未拆分：
   a. 移除原始 polymer 组件
   b. 通过 MolScript 表达式创建抗体组件：
      chain-test: auth_asym_id ∈ {'A', 'B'}
      label: 'Antibody (A, B)'
   c. 通过 MolScript 表达式创建抗原组件：
      chain-test: auth_asym_id = 'C'
      label: 'Antigen (C)'
   d. 两个组件分别添加 molecular-surface representation
3. 如果已拆分：直接替换现有 Antibody/Antigen 组件的 representation
```

### 6.6 颜色模式切换

`applyColoring(plugin, colorMode)` 独立于表示模式切换：

```js
async function applyColoring(plugin, colorMode) {
  const themeName = colorMode === 'electrostatic' ? electrostaticThemeName : plddtThemeName
  await plugin.dataTransaction(async () => {
    for (const s of plugin.managers.structure.hierarchy.current.structures) {
      await plugin.managers.structure.component.updateRepresentationsTheme(
        s.components, { color: themeName }
      )
    }
  })
}
```

使用 `dataTransaction` 确保批量更新所有组件的主题。

### 6.7 残基选中与高亮

两层高亮机制：

**Group Highlight（选中态 — 橙色选区光晕）：**
```
1. buildResidueExpression(residues)
   — 按链分组，生成 MolScript 表达式
   — 多链时使用 MS.struct.combinator.merge() 合并
2. getLoci(plugin, expression)
   — 通过 Script.getStructureSelection() 执行查询
   — 返回 StructureSelection loci
3. plugin.managers.interactivity.lociSelects.selectOnly({ loci })
   — 使用 Mol* 原生选择机制，显示橙色高亮
```

**Residue Focus（聚焦态 — 相机飞入 + 键显示）：**
```
1. applyResidueFocus(plugin, residue, focusRefRef)
   — 清除上一次 focus
   — 构建单残基 MolScript 表达式
   — plugin.managers.structure.focus.setFromLoci(loci)  ← 触发 Mol* 原生键显示
   — plugin.managers.camera.focusLoci(loci, { durationMs: 500 })  ← 500ms 动画飞入
```

### 6.8 Click 事件处理

通过 `plugin.behaviors.interaction.click.subscribe()` 订阅原生 canvas 点击：

```js
plugin.behaviors.interaction.click.subscribe(({ current }) => {
  const { loci } = current
  // 检查是否点击了结构元素
  if (!StructureElement.Loci.is(loci) || isEmpty(loci)) {
    onResidueClick(null)  // 点击空白区域，取消选中
    return
  }
  // 提取残基信息
  const loc = StructureElement.Location.create(loci.structure)
  loc.unit = loci.elements[0].unit
  loc.element = unit.elements[OrderedSet.getAt(indices, 0)]
  const chain = SP.chain.auth_asym_id(loc)    // 链 ID
  const seqId = SP.residue.auth_seq_id(loc)   // 序列位置
  const resType = SP.atom.auth_comp_id(loc)   // 残基类型（三字母）
  onResidueClick({ chain, seqId, resType })
})
```

通过 `clickFromStructureRef` 标志位防止 click → focus → click 循环。

---

## 七、互作 SVG Overlay

### 7.1 设计思路

在 Mol\* WebGL canvas 上叠加一个 `<svg>` 层，通过 `position: absolute` + `pointerEvents: none` 实现"零侵入"的标注。

```html
<div style="position: relative">
  <div ref={parentRef} />      <!-- Mol* WebGL canvas -->
  <svg ref={overlayRef}        <!-- SVG overlay，同尺寸 -->
    style="position: absolute; top: 0; left: 0;
           width: 100%; height: 100%;
           pointer-events: none; z-index: 1" />
</div>
```

### 7.2 数据流

```
focusedResidue 变化
  ↓
flattenInteractions(interactions, focusedResidue)
  — 过滤出与当前残基相关的所有互作边
  — 统一为 { type, from: {chain, resSeq, atom}, to: {chain, resSeq, atom}, distance } 格式
  ↓
buildAtomCoordsMap(plugin, ixItems)
  — 遍历 Mol* structure.units 中所有原子
  — 通过 StructureElement.Location 读取 auth_asym_id / auth_seq_id / label_atom_id
  — 通过 unit.conformation.x/y/z(element) 获取 3D 坐标
  — 以 "chain:resSeq:atom" 为 key 存入 Map
  — 找不到精确原子时，使用同残基的任意原子作为 fallback
  ↓
createOverlayElements(overlayRef, ixItems, coordsMap)
  — 对每条互作边，创建 4 个 SVG 元素：
    · <line> — 彩色虚线（strokeDasharray="4 3"，按类型着色）
    · <text> distText — 中点显示距离（如 "2.89Å"）
    · <text> fromText — 起点显示原子名（如 "OG"）
    · <text> toText — 终点显示原子名（如 "N2"）
  — 文字使用 stroke="#000" strokeWidth="3" + paintOrder="stroke" 实现描边效果
  ↓
requestAnimationFrame 循环 → updateOverlayPositions()
  — 每帧调用 worldToScreen() 将 3D 坐标投影到 2D
  — 更新所有 SVG 元素的 x/y 坐标
  — 如果原子在相机背面（cw ≤ 0.001），设置 visibility="hidden"
```

### 7.3 3D→2D 投影（worldToScreen）

手动执行完整的 MVP 变换链：

```js
function worldToScreen(plugin, wx, wy, wz, sw, sh) {
  const v = plugin.canvas3d.camera.view        // 4×4 view 矩阵
  const p = plugin.canvas3d.camera.projection  // 4×4 projection 矩阵

  // View 变换：world → eye space
  const ex = v[0]*wx + v[4]*wy + v[8]*wz + v[12]
  const ey = v[1]*wx + v[5]*wy + v[9]*wz + v[13]
  const ez = v[2]*wx + v[6]*wy + v[10]*wz + v[14]
  const ew = v[3]*wx + v[7]*wy + v[11]*wz + v[15]

  // Projection 变换：eye → clip space
  const cx = p[0]*ex + p[4]*ey + p[8]*ez + p[12]*ew
  const cy = p[1]*ex + p[5]*ey + p[9]*ez + p[13]*ew
  const cw = p[3]*ex + p[7]*ey + p[11]*ez + p[15]*ew

  // 透视除法 + NDC → screen
  return {
    x: (cx/cw * 0.5 + 0.5) * screenWidth,
    y: (1 - (cy/cw * 0.5 + 0.5)) * screenHeight,
  }
}
```

### 7.4 互作颜色编码

| 类型 | 颜色 | Hex |
|------|------|-----|
| H-Bond | 绿色 | `#00cc66` |
| π-π Stacking | 橙色 | `#ff8800` |
| π-Cation | 黄色 | `#ffcc00` |
| Salt Bridge | 红色 | `#ff4444` |
| Hydrophobic | 紫色 | `#bb88ff` |

---

## 八、非共价相互作用计算引擎（interactionAnalyzer）

### 8.1 概述

纯前端 PDB 解析 + 距离/角度计算引擎，497 行。直接解析 PDB 文本文件的 ATOM/HETATM 记录行，无依赖。

### 8.2 导出函数

| 函数 | 场景 | 分离方式 |
|------|------|---------|
| `analyzeInteractions(pdbUrl)` | 酶-配体 | ATOM（蛋白）vs HETATM（配体），自动分离 |
| `analyzeProteinProteinInteractions(pdbUrl, chainsA, chainsB)` | 抗体-抗原 | 按传入的链组分离 |

### 8.3 PDB 行解析

按固定列位置解析（PDB 格式规范）：

```js
function parsePdbLine(line) {
  return {
    serial: parseInt(line.substring(6, 11)),       // 原子序号
    atomName: line.substring(12, 16).trim(),       // 原子名（如 CA, OG, NZ）
    resName: line.substring(17, 20).trim(),        // 残基名（如 ALA, GLU）
    chain: line.substring(21, 22).trim(),          // 链 ID
    resSeq: parseInt(line.substring(22, 26)),       // 残基序号
    x: parseFloat(line.substring(30, 38)),         // x 坐标 (Å)
    y: parseFloat(line.substring(38, 46)),         // y 坐标
    z: parseFloat(line.substring(46, 54)),         // z 坐标
    element: line.substring(76, 78).trim(),        // 元素符号
  }
}
```

### 8.4 五种互作类型判定

#### H-Bond（氢键）
- **距离阈值**：3.5 Å
- **条件**：极性原子 N/O/S 之间的接触
- **判定逻辑**：donor 原子元素 ∈ {N, O, S} 且 acceptor 原子元素 ∈ {N, O, S}
- **返回字段**：donorChain, donorPosition, donorResidue, donorAtom, acceptorChain, acceptorPosition, acceptorResidue, acceptorAtom, distance

#### π-π Stacking（π-π 堆积）
- **距离阈值**：6.5 Å（环质心间距）
- **角度条件**：二面角 < 30°（面对面）或 > 60°（边对面）
- **芳香环检测**：
  - 蛋白侧：预定义 PHE/TYR/TRP/HIS 的环原子
  - 配体侧：通过 DFS 图遍历检测 ≤ 6 元环
- **辅助计算**：
  - `centroid(atoms)` → 环质心
  - `ringNormal(atoms)` → 环法向量（通过叉积计算）
  - `normalAngle(n1, n2)` → 两环法向量的夹角

#### π-Cation（π-阳离子）
- **距离阈值**：6.0 Å
- **条件**：芳香环质心 vs 阳离子原子（ARG 的 CZ/NH1/NH2，LYS 的 NZ，HIS 的 ND1/NE2）
- **双向检测**：配体环 ↔ 蛋白阳离子，蛋白环 ↔ 配体阳离子

#### Salt Bridge（盐桥）
- **距离阈值**：4.0 Å
- **条件**：配体 O/N 原子 vs 蛋白带电残基（ASP/GLU 的 OD/OE，ARG 的 NH/NE，LYS 的 NZ，HIS 的 ND1/NE2）

#### Hydrophobic（疏水接触）
- **距离阈值**：4.5 Å
- **条件**：配体碳原子 vs 疏水残基（ALA/VAL/LEU/ILE/PHE/TRP/MET/PRO）的碳原子
- **去重**：按残基对去重，每对残基只保留最近的碳-碳接触

### 8.5 蛋白-蛋白互作（抗体-抗原）

`analyzeProteinProteinInteractions` 使用完全相同的五种判定标准，差异仅在原子分组方式：

- 不再按 ATOM/HETATM 分离，而是按 `chainsA` 和 `chainsB` 分离
- 蛋白侧的芳香环检测使用预定义环原子表（PHE/TYR/TRP/HIS）
- 疏水接触的碳原子筛选同时适用于双方

### 8.6 返回数据结构

```js
{
  hBonds: [{
    donorChain, donorPosition, donorResidue, donorAtom,
    acceptorChain, acceptorPosition, acceptorResidue, acceptorAtom,
    distance
  }],
  piPiStacks: [{
    chain1, position1, residue1, chain2, position2, residue2,
    distance, angle
  }],
  piCations: [{
    ringChain, ringPosition, ringResidue,
    cationChain, cationPosition, cationResidue, cationAtom,
    distance
  }],
  saltBridges: [{
    chain1, position1, residue1, atom1,
    chain2, position2, residue2, atom2,
    distance
  }],
  hydrophobics: [{
    chain1, position1, residue1, atom1,
    chain2, position2, residue2, atom2,
    distance
  }]
}
```

---

## 九、互作数据面板（InteractionsCard）

### 9.1 功能

`InteractionsCard`（~L982）提供两种视图切换：

- **Table 视图**：按互作类型分组的数据表格（手风琴折叠），显示完整的原子级信息
- **2D 视图**：SVG 互作图（根据任务类型自动选择图表类型）

### 9.2 CDR/All 筛选（抗体模式）

抗体模式下，增加 CDR/All toggle 按钮：

```js
const cdrMap = buildCdrLookup(annotationGroups)
// cdrMap: "B:31" → "CDR-H1", "C:95" → "CDR-L3", ...

const filterByCdr = (rows, abChainKey, abSeqIdKey) => {
  if (!epitopeOnly || cdrMap.size === 0) return rows
  return rows.filter(b => cdrMap.has(`${b[abChainKey]}:${b[abSeqIdKey]}`))
}
```

- **CDR 模式**：仅显示抗体侧残基落在 CDR 区域内的互作
- **All 模式**：显示所有互作（包括 Framework 区域）

### 9.3 抗体模式表格分组

`GroupedDonorAcceptorTable` / `GroupedPairTable` 实现按抗原表位残基分组：

```
groupByEpitope(rows, antigenKey, antibodyKey, cdrMap)
  ↓
按抗原残基分组：
  C:105 THR
    ├─ B:31 ASN (CDR-H1)  H-Bond  3.21Å
    ├─ B:33 TYR (CDR-H1)  H-Bond  2.89Å
    └─ C:56 ASP (CDR-L2)  H-Bond  3.45Å
  C:107 GLY
    └─ B:97 ALA (CDR-H3)  H-Bond  3.12Å
```

每组内按 CDR 顺序排序：CDR-H1 → CDR-H2 → CDR-H3 → CDR-L1 → CDR-L2 → CDR-L3 → Framework。

### 9.4 表格行交互

每行支持三种高亮状态：

| 状态 | CSS class | 触发条件 |
|------|-----------|---------|
| `focused` | 点击当前行 | `selectedRow === "section:index"` |
| `related` | 同表位残基对的其他互作 | `selectedPair` 匹配 ab+ag 链位 |
| `ext-focused` | 外部选中（如从 3D viewer 点击） | `focusedResidues` 匹配行中任一残基 |

---

## 十、2D 互作图

### 10.1 路由分发

`InteractionDiagram2D`（~L1288）根据条件选择渲染哪种图表：

```
if (taskType === 'enzyme' && ligandData)     → LigandSkeletonDiagram
if (taskType === 'antibody' && abChains)     → ProteinProteinDiagram
else                                          → RadialDiagram (fallback)
```

### 10.2 ProteinProteinDiagram（抗体-抗原双列图）

**布局算法：**

```
SVG viewBox: 480 × H (H = max(280, topPad + maxN × 50 + 30))

左列 x=85:  抗体残基，按链+位置排序，垂直间距 50px
右列 x=395: 抗原残基，同上
居中对齐：startY = topPad + (H - topPad - 30 - N × 50) / 2 + 25
```

**边的规范化：**

互作边需要统一方向（抗体→抗原）。通过 `abSet.has(s1.chain)` 判断哪侧是抗体：

```js
const norm = (s1, s2, type, dist) =>
  abSet.has(s1.chain)
    ? { ab: s1, ag: s2, type, dist }
    : { ab: s2, ag: s1, type, dist }
```

**扇形展开（同残基对多条互作）：**

```js
const edgeGroups = new Map()  // key: "abChain:abPos-agChain:agPos"
// 同一残基对的多条边，通过 y 方向偏移展开：
const fanSpread = 6  // 像素
const offset = -(group.length - 1) * fanSpread / 2
// 第 i 条边的 y 偏移 = offset + i * fanSpread
```

**每条边的标注：**
- 两端：原子名（如 `OG`, `N2`），字号 7px
- 中点：距离值（如 `2.89Å`），字号 6.5px，半透明白色

**节点渲染：**
- 圆形，r=18，按氨基酸物化性质着色：
  - 疏水（ALA/VAL/LEU/ILE/PHE/TRP/MET/PRO）→ 绿色 `#4caf50`
  - 正电（ARG/LYS/HIS）→ 蓝色 `#5b8ff9`
  - 负电（ASP/GLU）→ 橙红 `#ff7043`
  - 极性（SER/THR/ASN/GLN/CYS/TYR）→ 青色 `#26c6da`
  - 特殊（GLY）→ 灰色 `#bdbdbd`
- 圆内上行：三字母残基名，下行：链:位置
- 抗体侧节点左方额外标注 CDR 区域（如 "CDR-H1"）

**点击高亮：**
通过 `connectedKeys` memo 实现 O(edges) 计算：

```js
const connectedKeys = useMemo(() => {
  if (!selectedKey) return null
  const keys = new Set([selectedKey])
  for (const e of atomEdges) {
    const abk = `${e.ab.chain}:${e.ab.pos}`
    const agk = `${e.ag.chain}:${e.ag.pos}`
    if (abk === selectedKey) keys.add(agk)
    if (agk === selectedKey) keys.add(abk)
  }
  return keys
}, [selectedKey, atomEdges])
```

非 connected 节点和边设置 `opacity={0.3}` / `opacity={0.15}`。

### 10.3 LigandSkeletonDiagram（配体 2D 拓扑图）

**PCA 降维：**

将配体 3D 坐标投影到最大方差平面：

```
1. 计算质心 mean = Σcoords / n
2. 中心化 centered = coords - mean
3. 计算 3×3 协方差矩阵 cov = Σ(c × c^T)
4. 幂迭代法求第一主成分 v1（50 次迭代）
5. 从 centered 中减去 v1 方向投影，得到残差
6. 对残差协方差矩阵再次幂迭代求 v2（50 次迭代）
7. 投影：x = dot(c, v1), y = dot(c, v2)
```

**配体骨架绘制：**

```
- 原子：圆形节点，按元素着色（C灰/N蓝/O红/S黄/P橙/F&Cl绿/Br棕）
- 键：距离 < 1.9Å 的原子对连线
- 过滤氢原子（element !== 'H'）
```

**蛋白残基环形排列：**

互作的蛋白残基按极角排列在配体骨架外围的圆上：
- 圆心 = 配体质心
- 半径 = 足够包含配体 + padding

**互作连线：**

从配体原子到蛋白残基的虚线，按互作类型着色。

**点击高亮：**
同 ProteinProteinDiagram，通过 `connectedAtoms` memo 计算关联原子集合。

---

## 十一、抗体编号方案与 Annotations

### 11.1 五种编号方案

```js
const NUMBERING_SCHEMES = ['IMGT', 'Kabat', 'EU', 'AHo', 'ANARCI']
```

抗体模式的 `annotations.json` 提供 `schemes` 对象，每种方案独立定义 CDR/Framework 分组及其残基范围：

```json
{
  "schemes": {
    "IMGT": { "groups": [{ "id": "cdr_h1", "label": "CDR-H1", "color": "#ff6b6b", "residues": [...] }] },
    "Kabat": { "groups": [...] },
    ...
  }
}
```

切换方案时，`activeGroups` 通过 useMemo 重新计算：

```js
const activeGroups = useMemo(() => {
  if (taskType === 'antibody' && annotations.schemes) {
    return annotations.schemes[activeScheme]?.groups ?? []
  }
  return annotations.groups ?? []
}, [annotations, taskType, activeScheme])
```

### 11.2 CDR 多选交互

每个注释分组支持点击 toggle 选中（`selectedGroupIds: Set<string>`）：

- 选中 → 残基在 3D viewer 中高亮（橙色选区光晕）
- 多选 → 多组残基同时高亮
- 右上角显示 `Clear (N)` 清除按钮

### 11.3 残基级交互

每个分组内的残基以 tag 形式展示（如 `A31ASN`），点击单个 tag：
- 触发 `handleResidueClick` → 3D viewer 聚焦 + overlay 标注
- tag 高亮显示（`focused` class）

---

## 十二、Liability 扫描器

### 12.1 扫描引擎（liabilityScanner.js）

106 行，30+ 条正则规则，纯前端执行。

**导出函数：**

| 函数 | 输入 | 输出 |
|------|------|------|
| `scanSequence(sequence, chain)` | 单条序列 + 链 ID | 命中数组 |
| `scanEntities(entities)` | information.entities | 所有链的命中合集 |

**规则结构示例：**

```js
const RULES = [
  { group: 'Deamidation', motif: 'NG', regex: /NG/g, risk: 'High', category: 'PTM' },
  { group: 'Deamidation', motif: 'NS', regex: /NS/g, risk: 'Medium', category: 'PTM' },
  { group: 'Oxidation',   motif: 'M',  regex: /M/g,  risk: 'High', category: 'PTM' },
  { group: 'N-glycosylation', motif: 'N-X-T', regex: /N[^P]T/g, risk: 'High', category: 'PTM' },
  ...
]
```

**扫描类别完整列表：**

| 类别 | Motif | Risk |
|------|-------|------|
| Deamidation | NG, NS, NT, NH, NN, NA, NE, NV | High/Medium |
| Oxidation | M, W, H, C | High/Medium |
| Isomerization | DG, DS, DT, DH, DD | High/Medium |
| N-glycosylation | N-X-T, N-X-S | High |
| Free Thiol | 奇数个 Cys | Medium |
| Cell Adhesion | RGD, LDV, KGD | Medium |
| Cleavage | DP, DK, EA, TS | Low |
| N-terminal Cyclization | ^Q, ^E | Medium |
| Hydroxylation | KG | Low |
| Lysine Glycation | KE, KD, KK | Low |

**RSA（Relative Solvent Accessibility）：** 当前使用 sin 函数生成确定性 mock 值，后续需接入实际计算。

**去重逻辑：** 同一位置同一 group 的重复命中，仅保留最高 risk 级别。

### 12.2 数据面板（LiabilityScanCard）

**功能特性：**

1. **按类别分组** — 手风琴折叠，每组显示名称 + 命中数 badge + 最高风险级别颜色
2. **多维筛选 Popover**：
   - **Group 筛选**：chip toggle 排除/包含特定类别
   - **Risk 筛选**：High / Medium / Low
   - **Chain 筛选**：多链时按链筛选
   - **RSA 范围**：双滑块 0-100%，预设按钮（Buried < 5%，Partial 5-20%，Exposed > 20%）
3. **命中行交互** — 点击行触发 3D viewer 聚焦到对应残基
4. **RSA 说明文案** — 底部解释 RSA 含义

**筛选实现：**

```js
const filtered = useMemo(() => {
  return hits.filter(h => {
    if (filterRisk.length > 0 && !filterRisk.includes(h.risk)) return false
    if (filterChains.length > 0 && !filterChains.includes(h.chain)) return false
    if (excludedGroups.has(h.group)) return false
    if (isRsaActive && (h.rsa < rsaMin || h.rsa > rsaMax)) return false
    return true
  })
}, [hits, filterRisk, filterChains, excludedGroups, rsaMin, rsaMax])
```

面板标题显示 `{filtered.length} / {total.length} hits`，筛选按钮显示 `Filter (N)`。

---

## 十三、同源蛋白叠加（Superimpose）

### 13.1 数据来源

从 `homologs.json` 加载静态列表（`HOMOLOG_SEARCH_ENABLED = false`）：

```json
[
  { "pdbId": "5XFZ", "identity": 100, "structureUrl": "/homologs/enzyme/5XFZ.cif" },
  { "pdbId": "5XG0", "identity": 97,  "structureUrl": "/homologs/enzyme/5XG0.cif" }
]
```

### 13.2 搜索模式（已实现但禁用）

支持三种搜索模式（`hSearchMode`）：

| 模式 | 输入 | 实现状态 |
|------|------|---------|
| PDB ID | 文本输入 | Mock 返回 |
| Sequence | 序列粘贴 | Mock 返回（`fetchHomologs.js` 可接入 RCSB API） |
| Structure | 文件上传 | Mock 返回 |

`fetchHomologs.js` 已实现完整的 RCSB API 调用：
```
POST https://search.rcsb.org/rcsbsearch/v2/query
→ sequence_similarity 查询
→ 获取 PDB ID 列表
→ 批量获取 entry + polymer_entity 元数据
→ 返回 { pdbId, title, resolution, organism, identity, evalue }
```

### 13.3 叠加算法（loadSuperimpose）

```
1. 下载同源结构文件（CIF 或 PDB 格式）
2. 解析为 trajectory → model → structure

3. 构建 Cα 原子查询：
   - 主结构：label_atom_id = 'CA'
     抗体模式额外约束：auth_asym_id = 'A'（仅用 A 链对齐）
   - 同源结构：label_atom_id = 'CA'（全部 Cα）

4. 执行查询，获取两组 Cα loci

5. 调用 Mol* 的 alignAndSuperpose([sel1, sel2])
   — 基于 Cα 坐标最小二乘拟合
   — 返回 4×4 变换矩阵 bTransform

6. 通过 StateTransforms.Model.TransformStructureConformation
   将变换矩阵应用到同源结构

7. 渲染同源结构为半透明 cartoon：
   color: 'uniform', colorParams: Color(0x88aaff)  // 浅蓝
   typeParams: { alpha: 0.7 }                       // 70% 不透明度
```

### 13.4 移除叠加

```js
async function removeSuperimpose(plugin, ref) {
  const cell = plugin.state.data.cells.get(ref.current.data)
  const update = plugin.state.data.build().delete(ref.current.data)
  await update.commit()
  ref.current = null
}
```

通过 state tree 的 `delete` 操作移除整个同源结构子树。

### 13.5 UI 交互

每个 `HomologRow` 显示：
- PDB ID（链接到 RCSB）
- 序列一致性百分比
- Superimpose toggle 开关

同一时间仅允许一个同源蛋白叠加（`superimposeId` 单值状态）。

---

## 十四、PAE 热图

### 14.1 PAECanvas（298 行）

基于 Canvas 2D API 的交互式热图组件。

**渲染逻辑：**
- 输入：PAE 矩阵（N×N 二维数组，值为 Å）
- 颜色映射：低 PAE（高置信度）→ 深绿，高 PAE → 白色
- 像素化渲染：每个残基对应矩阵中一个像素

**交互功能：**
- ResizeObserver 自适应容器尺寸
- 拖拽选区查看局部 PAE 值
- 鼠标悬停显示具体数值

**数据加载：**
```js
// 随 activeSample 变化加载
fetch(`/${folder}/confidences_sample_${activeSample + 1}.json`)
  .then(r => r.json())
  .then(setFullData)
```

---

## 十五、序列条（SequenceBar）

### 15.1 组件接口

```jsx
<SequenceBar
  entities={information.entities}   // 实体数组，包含 chain + sequence
  groups={activeGroups}             // 当前编号方案的注释分组
  focusedResidues={focusedResidues} // 多选焦点残基
  onResidueClick={handleResidueClick}
/>
```

### 15.2 渲染逻辑

按链（Chain）分组展示：

```
Chain A: MVKL...（每个字符一个 span）
Chain B: DIQM...
Chain C: GSHM...
```

每个残基字符：
- 按注释分组着色（CDR-H1 红色，CDR-L1 蓝色等）
- 无注释的残基显示默认灰色
- 点击触发 `onResidueClick`
- 焦点残基显示高亮背景

首行显示注释颜色图例（从 `groups` 中提取）。

### 15.3 粘性链标签

每个链标签使用 `position: sticky; top: 0` 在滚动时保持可见，背景色与容器一致防止文字穿透。

---

## 十六、3D Viewer 工具栏与图例系统

### 16.1 布局结构

工具栏位于 3D viewer 内部顶部，`position: absolute; top: 8px`：

```
┌─────────────────────────────────────────────┐
│ [Surface|Cartoon] [pLDDT|Electro] │ Legend  │
│        ← 50% →                    │ ← 50% →│
└─────────────────────────────────────────────┘
```

- 固定高度 `height: 42px`，避免图例切换时跳动
- `align-items: stretch` 确保左右等高
- 左半（`.rp-toolbar-half`）包含两个 toggle 组，各 `flex: 1`
- 右半为图例，`flex: 1`
- 半透明背景 `rgba(20,20,20,0.55)` + `backdrop-filter: blur(10px)`

### 16.2 图例切换逻辑

图例区域根据 `focusedIxTypes` 和 `colorMode` 三态切换：

```jsx
{focusedIxTypes ? (
  <BondTypeLegend />        // 选中残基有互作时
) : colorMode === 'plddt' ? (
  <PlddtLegend />           // pLDDT 模式
) : colorMode === 'electrostatic' ? (
  <ElectrostaticLegend />   // Electrostatic 模式
) : null}
```

**pLDDT 图例：** 四段色条，文字在上（>90, 70–90, 50–70, <50）

**Electrostatic 图例：** 三标签（Negative, Neutral, Positive）+ 红白蓝渐变条

**Bond Type 图例：** 动态显示当前残基涉及的互作类型（`focusedIxTypes` 计算逻辑）：

```js
const focusedIxTypes = useMemo(() => {
  if (!focusedResidues.length || !interactions) return null
  const match = (c, s) => focusedResidues.some(r => r.chain === c && r.seqId === s)
  const types = []
  if (interactions.hBonds?.some(b => match(b.donorChain, b.donorPosition) || ...)) types.push('hBond')
  // ... 检查所有五种类型
  return types.length ? types : null
}, [focusedResidues, interactions])
```

---

## 十七、全局残基联动机制

### 17.1 核心数据流

用户在任意位置点击残基，触发全局联动：

```
用户点击残基
  ↓ handleResidueClick(residue, e)
  ↓ setFocusedResidues(toggle in/out)
  ↓
  ├→ highlightedResidues (useMemo)
  │   → selectedGroupIds 残基 + hoveredGroupId 残基 + focusedResidues + hoveredIxResidue
  │   → 传入 MolstarViewer.highlightedResidues → applyGroupHighlight()
  │
  ├→ lastFocused = focusedResidues[last]
  │   → 传入 MolstarViewer.focusedResidue → applyResidueFocus() + overlay
  │
  ├→ focusedIxTypes (useMemo)
  │   → 工具栏图例切换为 Bond 类型
  │
  ├→ SequenceBar.focusedResidues → 对应残基高亮
  │
  ├→ InteractionsCard.focusedResidues → 表格行 ext-focused 高亮
  │
  └→ 2D 图的 selectedKey → connectedKeys → 非关联节点降低透明度
```

### 17.2 点击来源

| 来源 | 入口函数 | 特殊处理 |
|------|---------|---------|
| 3D Viewer | `onResidueClick` prop | `clickFromStructureRef` 防止 focus 循环 |
| SequenceBar | `onResidueClick` prop | 直接调用 `handleResidueClick` |
| Annotations tag | 内联 `onClick` | 调用 `handleResidueClick` |
| Interactions table | `onResidueFocus` callback | 通过 InteractionsCard 转发 |
| Liability hit | `onHitClick` callback | 聚焦到 hit 的起始残基 |
| 2D 图节点 | `onResidueFocus` callback | 通过 InteractionDiagram2D 转发 |

### 17.3 多选逻辑

`focusedResidues` 是数组，支持多残基选中：

```js
const handleResidueClick = (residue, e) => {
  if (!residue) {
    setFocusedResidues([])      // 点击空白 → 清空
    setSelectedGroupIds(new Set())
    return
  }
  setFocusedResidues(prev => {
    const idx = prev.findIndex(r => r.chain === residue.chain && r.seqId === residue.seqId)
    return idx >= 0
      ? prev.filter((_, i) => i !== idx)   // 已选中 → 取消
      : [...prev, residue]                 // 未选中 → 加入
  })
}
```

`lastFocused`（最后一个选中的残基）传给 MolstarViewer 作为相机聚焦目标。

---

## 十八、数据规范

### 18.1 任务目录标准结构

```
scenario-folder/
├── information.json                      # 任务输入
├── annotations.json                      # 结构注释
├── homologs.json                         # 同源蛋白列表
├── confidences_sample_{1-5}.json         # PAE 矩阵
├── summary_confidences_sample_{1-5}.json # 置信度汇总
└── model_sample_{1-5}.pdb               # 预测结构（B-factor = pLDDT）
```

### 18.2 information.json

```json
{
  "seed": 42,
  "entities": [
    { "type": "protein", "copies": 1, "chain": "A", "sequence": "MVKL...", "label": "Antigen" },
    { "type": "protein", "copies": 1, "chain": "B", "sequence": "DIQM...", "label": "Heavy chain" },
    { "type": "protein", "copies": 1, "chain": "C", "sequence": "EIVL...", "label": "Light chain" },
    { "type": "ligand",  "copies": 1, "chain": "B", "smiles": "CC(=O)..." }
  ]
}
```

`label` 字段用于区分抗体/抗原链（包含 "heavy"/"light" → 抗体，"antigen" → 抗原）。

### 18.3 annotations.json

**酶模式：**
```json
{
  "groups": [
    {
      "id": "active-site",
      "label": "Active Site",
      "color": "#ff6b6b",
      "reprType": "ball-and-stick",
      "residues": [{ "chain": "A", "seqId": 105, "resType": "SER" }]
    }
  ]
}
```

**抗体模式：**
```json
{
  "schemes": {
    "IMGT": {
      "groups": [
        { "id": "cdr_h1", "label": "CDR-H1", "color": "#ff6b6b",
          "residues": [{ "chain": "B", "seqId": 26, "resType": "GLY" }, ...] }
      ]
    },
    "Kabat": { "groups": [...] },
    "EU":    { "groups": [...] },
    "AHo":   { "groups": [...] },
    "ANARCI":{ "groups": [...] }
  }
}
```

### 18.4 homologs.json

```json
[
  { "pdbId": "5XFZ", "identity": 100, "structureUrl": "/homologs/enzyme/5XFZ.cif" },
  { "pdbId": "5XG0", "identity": 97,  "structureUrl": "/homologs/enzyme/5XG0.cif" }
]
```

### 18.5 summary\_confidences

```json
{
  "iptm": 0.87,
  "ptm": 0.91,
  "chain_iptm": [0.89, 0.85],
  "chain_ptm": [0.92, 0.90],
  "chain_pair_iptm": [[0.89, 0.83], [0.83, 0.85]],
  "chain_pair_pae_min": [[1.2, 3.4], [3.4, 1.1]],
  "fraction_disordered": 0.03,
  "has_clash": false,
  "ranking_score": 0.88
}
```

---

## 十九、构建与运行

```bash
npm install         # 安装依赖
npx vite            # 开发模式（热更新）
npx vite build      # 生产构建 → dist/
npx vite preview    # 预览生产构建
```

**构建产物特征：**
- Mol\* 相关 chunks 较大（transforms ~1.2MB, mol-plugin-ui ~790KB）
- 主业务 chunk index ~285KB
- gzip 后总量约 ~850KB

---

## 二十、已知限制与后续方向

| 项 | 现状 | 后续方向 |
|----|------|---------|
| 后端集成 | 纯静态数据，无实际预测 API | 接入 MMFold 2.0 推理服务 |
| 路由 | 内存状态机，无 URL 深链接 | 引入 React Router，支持 URL 直达结果 |
| 同源搜索 | 静态 JSON（`HOMOLOG_SEARCH_ENABLED = false`） | 启用 RCSB API 实时搜索 |
| Liability RSA | 确定性 mock 值（sin 函数） | 接入 DSSP/FreeSASA 计算 |
| 移动端 | 仅桌面端布局 | 响应式适配 |
| 多任务管理 | 内存状态，刷新即丢失 | 持久化 + 后端任务队列 |
| ResidueInspector | 组件已实现但 JSX 中注释掉 | 评估是否启用 |
| 抗体表面拆分 | 硬编码 A/B 为抗体、C 为抗原 | 动态从 information 读取 |
