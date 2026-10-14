# 冰雾工作台 · 配色系统 v2

> 给编码 Agent 的实现规范，适用于 `apps/dashboard`。
> 依据分支 `wip/ui-snapshot`（9b1ed7d）的实际代码编写：沿用已有的冰雾变量名（`--c-*`、`--text-*`、`--surface-*`、`--edge-*`、`--status-*`），只做修正和补充。
> 本文件取代 `ice-mist-ui-spec.md` 第二节的颜色部分，以及 `docs/adr/0002-one-workbench.md` 里 "Visual language" 下的 Task / Company status colors。
> 所有对比度都按 WCAG 公式实算。

---

## 一、原则

1. **颜色只表达状态，类型由图标和文字表达。** 一个状态一种颜色，不为「类别」「推荐」「新」再发明颜色。
2. **只有一个强调色：炭黑 `#25282E`。** 它同时代表「主操作」和「轮到你了」。页面上炭黑的实心元素，就是需要用户行动的地方。
3. **语义色只有四个，全部低饱和**：成功（青绿）、失败（陶红）、进行中（钢蓝）、提醒（沙色）。
4. **面积比例**：背景（雾灰、冰蓝灰）约 60%，暖白表面约 30%，炭黑约 8%，语义色 ≤ 2%。语义色只出现在小标签、图标、单行提示上，不铺大面积底色。
5. **禁止的写法**（这些就是「AI 感」的来源）：
   - 卡片左侧彩色竖条（`border-l-4 border-l-*`）
   - 用琥珀色表达「需要你」「待审核」「暂停」
   - 绿色底的结果区、紫色的审核区、绿色的「推荐」标签
   - 呼吸、发光、闪烁的动画（`animate-pulse`、`creation-step-breathe`）
   - 用 `opacity-50` 做禁用态
   - 八色彩虹的部门色
   - 组件里直接写 Tailwind 色阶（`amber-*`、`emerald-*`、`red-*`、`blue-*`、`violet-*`、`slate-*`）

---

## 二、现状诊断（wip/ui-snapshot）

| # | 问题 | 位置 | 处理 |
|---|---|---|---|
| 1 | **琥珀色的「待审核 / 需要你」**：`--status-waiting-fg #8A5300 / bg #FAEFD9`。这个值来自上一版规格，是那一版的错误：琥珀色本身就是 AI 界面最常见的「提醒」写法 | `styles.css`、`ice-mist.css`、`StatusTag.tsx`、`IceMistDevPage.tsx` | 改为「轮到你」：炭黑底白字（见 3.3） |
| 2 | **两套变量并存**：冰雾变量是新配色，但 shadcn 变量（`--primary` 深海军蓝、`--ring` 和 `--accent` 青绿）没动。所有还没迁移的页面和 `components/ui/*` 仍在用旧配色 | `styles.css` 顶部 `:root` | shadcn 变量改为引用冰雾变量（见 4.2），未迁移的页面自动换色 |
| 3 | **输入框和次按钮边框太淡**：`--edge-input` 是 28% 透明炭黑，叠在暖白上只有 **1.75:1**，达不到边框要求的 3:1 | `--edge-input`，被 `.im-pill[data-variant="secondary"]`、禁用按钮使用 | 新增 `--edge-strong #7A8590`（3.31:1）用于输入框和描边按钮 |
| 4 | **呼吸发光动画**：`creation-step-breathe` 让卡片阴影和光圈持续变化，并且用的是旧的青绿 `--ring`。目前没有组件引用它，是遗留代码 | `styles.css` | 删除 `@keyframes creation-step-breathe` 和 `.creation-step-current` |
| 5 | **未迁移页面里还有 31 处 `amber-*`**，以及 emerald、red、blue、violet、slate 色阶和三处左侧色条 | `components/ceo-office/*`、`department-page/*`、`workbench/*`、`replan/*`、`pages/*` | 见第七节迁移清单 |
| 6 | 缺少「提醒」和「中性」两种状态色，也缺少状态的边框色和图标色 | `styles.css` | 见 3.3 |

已经做对、保持不变的：五个基础色、`--text-secondary #56616C`、成功 / 失败 / 进行中三组颜色、单层模糊外壳、禁用态不用透明度、主按钮 hover 用 `color-mix`。

---

## 三、色板

### 3.1 基础五色（产品负责人指定，不可修改）

| 变量 | Hex | 角色 |
|---|---|---|
| `--c-mist` 雾灰 | `#E9EEEE` | 页面背景、次要底色 |
| `--c-ice` 冰蓝灰 | `#DAE3EB` | 工作区环境色、次按钮底、hover |
| `--c-cool` 冷调蓝 | `#C7D3E0` | 选中态、环境光；**上面只放炭黑文字** |
| `--c-warm` 暖白 | `#F4F2F1` | 外壳、卡片、输入框 |
| `--c-charcoal` 炭黑 | `#25282E` | 主文字、主按钮、「轮到你」 |

### 3.2 文字与边框

| 变量 | 值 | 用途 | 对比度（暖白 / 雾灰 / 冰蓝灰） |
|---|---|---|---|
| `--text-primary` | `#25282E` | 正文、标题 | 13.24 / 12.61 / 11.37 |
| `--text-secondary` | `#56616C` | 元信息、placeholder、说明文字 | 5.66 / 5.40 / 4.87 |
| `--text-disabled` | `#8A949E` | 仅禁用态 | 2.76（禁用态豁免） |
| `--text-on-dark` | `#FFFFFF` | 炭黑和陶红上的文字 | 炭黑上 14.77 |
| `--edge-strong`（新增） | `#7A8590` | 输入框边框、描边按钮、中性图标 | 3.37 / 3.21 / 2.89 |
| `--edge-input`（保留） | `rgba(37,40,46,0.28)` | **只作装饰**：禁用控件边框、卡片内分组 | 1.75 |
| `--edge-divider` | `rgba(37,40,46,0.08)` | 分隔线 | 装饰 |
| `--edge-highlight` | `rgba(255,255,255,0.7)` | 玻璃高光边 | 装饰 |

冷调蓝上的次要文字只有 4.16，不达标，所以冷调蓝上一律用炭黑。

### 3.3 状态色（每个状态四个值）

| 状态 tone | fg 文字 | bg 底色 | border 边框 | icon 图标 | fg/bg | 图标/暖白 |
|---|---|---|---|---|---|---|
| `success` 成功（青绿） | `#0F6B5C` | `#E1F0EC` | `#B9DBD2` | `#1C8270` | 5.45 | 4.20 |
| `failed` 失败（陶红） | `#B13A2A` | `#FBE8E3` | `#F1C3B8` | `#C4513F` | 5.06 | 4.09 |
| `running` 进行中（钢蓝） | `#3D5A80` | `#E3EAF3` | `#C3D1E3` | `#4F6E99` | 5.83 | 4.68 |
| `caution` 提醒（沙色，新增） | `#7A5A1E` | `#F3ECDD` | `#E2D3B3` | `#9A7428` | 5.40 | 3.84 |
| `queued` 中性（等待、暂停、已停止、已取消） | `#56616C` | `#E9EEEE` | `#D5DCE3` | `#7A8590` | 5.40 | 3.37 |
| `yourTurn` 轮到你（取代 `waiting`） | `#FFFFFF` | `#25282E` | — | `#FFFFFF` | 14.77 | — |

**沙色的使用边界**：只用于「没有失败，但内容可能过时或有风险」，例如方案已过期、能力发生变化、连接中断、选择了 Autonomous 权限。**同一屏最多一处。** 它不表示「需要你」，也不表示「暂停」。

和旧的琥珀色对比：琥珀 `#8A5300 / #FAEFD9` 饱和度高、偏橙；沙色 `#7A5A1E / #F3ECDD` 饱和度低、偏灰，和冷灰背景放在一起不跳。

---

## 四、变量实现

### 4.1 冰雾变量：修改和新增（`src/styles.css` 第二个 `:root`）

```css
:root {
  /* 修改：琥珀 waiting 删除 */
  /* --status-waiting-fg: #8a5300;  删除 */
  /* --status-waiting-bg: #faefd9;  删除 */

  /* 新增：边框 */
  --edge-strong: #7a8590;

  /* 新增：状态的边框和图标色 */
  --status-success-border: #b9dbd2;  --status-success-icon: #1c8270;
  --status-failed-border:  #f1c3b8;  --status-failed-icon:  #c4513f;
  --status-running-border: #c3d1e3;  --status-running-icon: #4f6e99;

  /* 新增：提醒 */
  --status-caution-fg: #7a5a1e;  --status-caution-bg: #f3ecdd;
  --status-caution-border: #e2d3b3;  --status-caution-icon: #9a7428;

  /* 新增：中性 */
  --status-neutral-fg: var(--text-secondary);  --status-neutral-bg: var(--c-mist);
  --status-neutral-border: #d5dce3;  --status-neutral-icon: var(--edge-strong);

  /* 新增：轮到你 */
  --status-your-turn-fg: var(--text-on-dark);  --status-your-turn-bg: var(--c-charcoal);

  /* 新增：其他 */
  --surface-popover: #fbfaf9;                  /* 弹窗、菜单、tooltip（不透明） */
  --scrim: rgba(37, 40, 46, 0.32);             /* 弹窗遮罩 */
  --text-selection: rgba(61, 90, 128, 0.18);
  --danger-solid-hover: #9e3324;               /* 最终确认的危险按钮 hover */
}
```

同时删除 `styles.css` 里的 `@keyframes creation-step-breathe` 和 `.creation-step-current` 两段（含 reduced-motion 里的那一行）。

### 4.2 shadcn 变量：改为引用冰雾配色（`src/styles.css` 第一个 `:root`）

shadcn 变量是 HSL 数值写法，不能直接 `var()` 引用 hex，所以写入对应的 HSL 值。改完后 `components/ui/*` 和所有还没迁移的页面会自动换成冰雾配色。

```css
--background: 180 13% 92%;          /* = --c-mist */
--foreground: 220 11% 16%;          /* = --c-charcoal */
--card: 20 12% 95%;                 /* = --c-warm */
--card-foreground: 220 11% 16%;
--popover: 30 20% 98%;              /* = --surface-popover */
--popover-foreground: 220 11% 16%;
--primary: 220 11% 16%;             /* 炭黑，原来是海军蓝 */
--primary-foreground: 0 0% 100%;
--secondary: 208 30% 89%;           /* = --c-ice */
--secondary-foreground: 220 11% 16%;
--muted: 180 13% 92%;
--muted-foreground: 210 11% 38%;    /* = --text-secondary */
--accent: 208 30% 89%;              /* = --c-ice，原来是青绿 */
--accent-foreground: 220 11% 16%;
--destructive: 7 62% 43%;           /* = --status-failed-fg */
--destructive-foreground: 0 0% 100%;
--border: 210 20% 86%;              /* = --status-neutral-border */
--input: 210 9% 52%;                /* = --edge-strong */
--ring: 214 35% 37%;                /* = --status-running-fg，原来是青绿 */
```

### 4.3 Tailwind（`tailwind.config.js` 的 `theme.extend.colors` 追加）

让未迁移的页面可以用语义类名代替色阶：

```js
status: {
  "success": "var(--status-success-fg)", "success-bg": "var(--status-success-bg)", "success-border": "var(--status-success-border)", "success-icon": "var(--status-success-icon)",
  "failed": "var(--status-failed-fg)",   "failed-bg": "var(--status-failed-bg)",   "failed-border": "var(--status-failed-border)",   "failed-icon": "var(--status-failed-icon)",
  "running": "var(--status-running-fg)", "running-bg": "var(--status-running-bg)", "running-border": "var(--status-running-border)", "running-icon": "var(--status-running-icon)",
  "caution": "var(--status-caution-fg)", "caution-bg": "var(--status-caution-bg)", "caution-border": "var(--status-caution-border)", "caution-icon": "var(--status-caution-icon)",
  "neutral": "var(--status-neutral-fg)", "neutral-bg": "var(--status-neutral-bg)", "neutral-border": "var(--status-neutral-border)", "neutral-icon": "var(--status-neutral-icon)",
},
"edge-strong": "var(--edge-strong)",
"selected": "var(--c-cool)",
```

用法：`bg-status-failed-bg text-status-failed`，图标 `text-status-failed-icon`。

### 4.4 StatusTag（`components/ice-mist/StatusTag.tsx` 和 `ice-mist.css`）

```ts
export type StatusTone = "success" | "failed" | "running" | "caution" | "queued" | "yourTurn";
```

| tone | 默认图标 |
|---|---|
| success | Check |
| failed | CircleAlert |
| running | LoaderCircle（转圈） |
| caution | TriangleAlert |
| queued | Clock（调用方可传入 Pause、CircleSlash 等覆盖） |
| yourTurn | Hand（调用方可传入 Eye 表示待审核） |

给 StatusTag 增加可选的 `icon` 属性，用于同一颜色、不同含义的场景。

```css
.im-tag[data-tone="caution"]  { color: var(--status-caution-fg); background: var(--status-caution-bg); }
.im-tag[data-tone="queued"]   { color: var(--status-neutral-fg); background: var(--status-neutral-bg); }
.im-tag[data-tone="yourTurn"] { color: var(--status-your-turn-fg); background: var(--status-your-turn-bg); font-weight: 600; }
/* 删除 .im-tag[data-tone="waiting"] */
```

---

## 五、组件配色表

### 5.1 背景与表面（已实现，保持）

| 位置 | 颜色 |
|---|---|
| 页面环境 | `--c-mist` + 左上 ice、右下 cool 的环境光（`.im-ambient`） |
| 应用外壳（唯一模糊层） | `--surface-shell` + 模糊（`.im-shell`） |
| 工作区 | ice 78% + cool 环境光（`.im-shell-workspace`） |
| 主要面板 | `--surface-panel`（`.im-panel`） |
| 阅读表面：结果、错误原因、长文本 | `--surface-reading`（`.im-reading`） |
| 弹窗、菜单、tooltip | `--surface-popover`，遮罩 `--scrim` |
| 代码 / 命令块 | 底 `--c-mist`，1px `--status-neutral-border`，文字炭黑，Geist Mono |
| 分隔线 | `--edge-divider` |

### 5.2 按钮（`.im-pill` 和 `components/ui/button.tsx` 统一）

| 类型 | 默认 | Hover | 禁用 |
|---|---|---|---|
| 主按钮 primary | 底炭黑，白字 | `color-mix` 炭黑 88%（已实现） | 底 `--surface-input`，字 `--text-disabled`，边框 `--edge-input` |
| 次按钮 secondary | 底 `--surface-input`，1px **`--edge-strong`**（原来是 `--edge-input`），字炭黑 | 底 `--c-warm` | 同上 |
| 幽灵 ghost | 透明，字炭黑 | 底 `--c-ice` | 字 `--text-disabled` |
| 危险次操作（放弃创建、停止运营的入口） | 透明，1px 陶红 45%，字 failed-fg（已实现） | 底 failed-bg | 同上 |
| 危险确认（确认弹窗里的最终按钮） | 底 failed-fg，白字（5.99） | 底 `--danger-solid-hover` | 同上 |
| 链接 | 字炭黑，下划线 | 字 running-fg | — |

- 焦点：`--focus-ring` 钢蓝描边（已实现）。
- `components/ui/button.tsx` 删除 `disabled:opacity-50`，改用上表的禁用色。
- 「暂停运营」按钮：次按钮样式 + Pause 图标，**不再是琥珀色**。

### 5.3 输入框（Input / Textarea / Select / Radio）

| 状态 | 底 | 边框 | 文字 |
|---|---|---|---|
| 默认 | `--surface-input` | 1px `--edge-strong` | 炭黑；placeholder `--text-secondary` |
| Hover | `--surface-input` | 1px `--text-secondary` | |
| 聚焦 | `--surface-input` | 1px 炭黑 + `--focus-ring` | |
| 错误 | `--surface-input` | 1px failed-fg | 下方错误文字 failed-fg + CircleAlert 图标 |
| 禁用 | `--c-mist` | 1px `--edge-input` | `--text-disabled` |
| 单选卡片 · 选中 | `--surface-reading` | 2px 炭黑 | 圆点炭黑 |
| 单选卡片 · 未选 | `--surface-input` | 1px `--edge-input` | |

### 5.4 提示条（`components/ui/alert.tsx` 增加 variant）

| variant | 底 | 边框 | 文字 | 图标 |
|---|---|---|---|---|
| info（默认） | running-bg | running-border | running-fg | Info |
| success | success-bg | success-border | success-fg | CircleCheck |
| caution | caution-bg | caution-border | caution-fg | TriangleAlert |
| danger | failed-bg | failed-border | failed-fg | CircleAlert |

业务代码里不再手写 `border-amber-300 bg-amber-50 text-amber-900`。

### 5.5 进度、选中、计数

| 元素 | 颜色 |
|---|---|
| 加载转圈 | running-icon |
| 进度条 | 轨道 `--c-ice`，填充炭黑 |
| 骨架屏 | ice → mist 渐变，仅 `motion-safe` 时动 |
| 导航当前项 | 底 `--c-cool`，字和图标炭黑 |
| 导航 hover | 底 `--c-ice` |
| 列表 / 节点选中 | 2px 炭黑边框 |
| 跳转定位高亮 | `--focus-ring`，2 秒后淡出 |
| 导航上「需要你」的数量 | yourTurn：炭黑底白字胶囊 |
| 「新」标签、新结果数量 | running 标签 |
| 有新活动的小圆点 | 6px running-icon，**不闪烁** |
| 诊断页统计数字 | 数字炭黑，前面 8px 对应状态的 icon 色圆点 |

### 5.6 Plan 画布（React Flow）

| 元素 | 颜色 |
|---|---|
| 画布背景 | `--c-mist`，点阵 `--c-cool` |
| 节点 | 底 `--c-warm`，1px `--status-neutral-border`；选中 2px 炭黑 |
| 连线 | `--edge-strong` 1.5px；高亮路径炭黑 |
| 部门标识 | 节点左上角 8px 圆点 + 部门名，不用色条，不给节点上底色 |

部门色（低饱和，对暖白均 ≥ 3.4:1）：

```ts
export const DEPARTMENT_COLORS = ["#5B7398", "#4F8A86", "#6F8656", "#A9705A", "#86698F", "#8E7440", "#5F8395", "#A06A7A"];
```

部门色只用于小圆点和部门图标，不能用来表示状态。

---

## 六、状态映射（取代 ADR 0002 的 status colors）

### 6.1 任务状态（`components/task/taskStatusTone.ts`）

现有 tone 名称保留，只改颜色和图标：

| tone | 原来 | 现在 | 图标 |
|---|---|---|---|
| running（含 retrying） | blue | running | LoaderCircle 转圈 |
| waiting | slate | queued | Clock |
| review | violet | yourTurn | Eye |
| needsYou（blocked / needs_replan） | amber | yourTurn | Hand |
| failed | red | failed | CircleAlert |
| complete | emerald | success | Check |
| cancelled | slate + 删除线 | queued + 删除线 | CircleSlash |

review 和 needsYou 颜色相同、图标和文字不同：两者都是「等你处理」，颜色只回答「要不要我动手」。

### 6.2 公司状态（`components/workbench/CompanyStatus.tsx`）

| 状态 | 原来 | 现在 |
|---|---|---|
| active | emerald | success |
| paused | amber | queued + Pause 图标 |
| stopped | slate | queued，文字 `--text-disabled` |
| creating | blue | running |
| creation_failed | red | failed |

### 6.3 其他位置

| 位置 | 现在 |
|---|---|
| CeoOutcomes：achieved / stalled / waiting | success / caution / queued |
| CeoOutcomes 类别：blocking / strategic / informational | yourTurn / queued（文字炭黑）/ queued |
| PlanGoals：met / missed / active | success / failed / queued |
| DecisionPanel「推荐」 | 描边标签：1px 炭黑，字炭黑 |
| ExecutionTrace 结果区 | `.im-reading`，标题旁一个 success 图标（不再是绿底） |
| ExecutionTrace 审核区 | `.im-reading` + yourTurn 标签（不再是紫底） |
| ExecutionTrace 停止原因 | `--text-secondary` + Pause 图标 |
| ExecutionTrace 高亮步骤 | running-bg |
| Replan 改动的字段行 | running-bg（改动不是警告） |
| Replan「方案已过期」「能力变化」 | caution |
| PageErrorBoundary 图标 | failed-icon（这是错误） |
| WorkbenchFrame 提示条 | 连接或过期类用 caution，一般说明用 info |
| 所有 `role="alert"` 的错误文字 | `text-status-failed` |

---

## 七、迁移清单

先运行下面的命令，以实际结果为准：

```bash
cd apps/dashboard
grep -rnE '(amber|emerald|red|blue|violet|slate|yellow|green|orange|purple)-[0-9]{2,3}' src --include=*.tsx --include=*.ts
grep -rnE 'border-l-4|animate-pulse|opacity-50|status-waiting|tone="waiting"|creation-step-breathe|#[0-9a-fA-F]{6}' src --include=*.tsx --include=*.ts --include=*.css
```

| 文件 | 改动 |
|---|---|
| `src/styles.css` | 4.1、4.2；删除呼吸动画 |
| `tailwind.config.js` | 4.3 |
| `components/ice-mist/StatusTag.tsx`、`ice-mist.css` | 4.4；次按钮边框改 `--edge-strong` |
| `pages/dev/IceMistDevPage.tsx` | 「待审核」改为 `tone="yourTurn"` + Eye 图标；补充 caution 和 queued 示例 |
| `components/ui/button.tsx` | 5.2，删除 `disabled:opacity-50` |
| `components/ui/alert.tsx` | 5.4 |
| `components/ui/input.tsx`、`textarea.tsx`、`radio-group.tsx` | 5.3 |
| `components/task/taskStatusTone.ts` | 6.1 |
| `components/workbench/CompanyStatus.tsx` | 6.2 |
| `components/workbench/WorkbenchRail.tsx` | 当前项用 `--c-cool`；数量胶囊改 yourTurn；蓝点去掉 `animate-pulse` |
| `components/workbench/WorkbenchShell.tsx` | 暂停按钮改次按钮 + Pause 图标 |
| `components/workbench/WorkbenchFrame.tsx`、`PageErrorBoundary.tsx` | 6.3 |
| `components/ceo-office/NeedsYou.tsx` | 删除三处 `border-l-4 border-l-amber-400`；分组标题改炭黑 + 图标；统计数字按 5.5 |
| `components/ceo-office/CeoOfficeCard.tsx` | 删除两处 `border-l-4`，改用对应 StatusTag；「新」用 running |
| `components/ceo-office/CeoOutcomes.tsx`、`PlanGoals.tsx`、`DecisionPanel.tsx`、`ReviewPanel.tsx`、`HumanActionPanel.tsx`、`CeoComposer.tsx` | 6.3 |
| `components/ceo-office/planLayout.ts` | 5.6：替换 `DEPARTMENT_COLORS`，连线色 `#64748b` 改 `--edge-strong` |
| `components/department-page/ExecutionTrace.tsx`、`TaskActions.tsx` | 6.1、6.3；删除 `border-l-4` |
| `components/replan/ReplanProposalCard.tsx` | 6.3 |
| `pages/OperationsDiagnostics.tsx`、`Deliverables.tsx`、`CeoOffice.tsx` | 5.5、6.1 |
| `ui/tasks/TaskExecutionPanel.tsx` | 错误文字改 `text-status-failed` |
| `App.test.tsx`（断言 `border-l-amber-400` 的几处） | 改为断言状态标签（例如 `data-tone="yourTurn"` 或标签文字）。**不要为了让测试通过而保留色条** |
| `e2e/visual-regression.spec.ts` | 配色变化后更新基准截图，在提交说明里写明原因 |
| `docs/adr/0002-one-workbench.md` | "Task status colors" 和 "Company status colors" 改为指向本文件第六节 |

建议分三次提交：① 变量和基础组件（styles.css、tailwind、StatusTag、ui/*）；② 状态映射（taskStatusTone、CompanyStatus）；③ 逐页清理色阶和色条。每次提交后截图确认。

---

## 八、验收

- [ ] 第七节的两条 grep 在 `src` 下返回空（`DEPARTMENT_COLORS` 里的 hex 除外）。
- [ ] 1440px 和 390px 下截图 CEO Office、部门页、诊断页、创建流程，检查：没有琥珀色；同一屏沙色提醒不超过一处；没有左侧色条；炭黑实心元素只出现在主按钮和「轮到你」上；同一个状态在不同页面颜色一致。
- [ ] 报告对比度：正文、元信息、placeholder、六种状态标签、输入框边框、导航当前项。
- [ ] `vitest` 和 `playwright` 全部通过，列出改动的测试和原因。
