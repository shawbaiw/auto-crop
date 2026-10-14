import { Eye, Layers, Pause, RotateCcw } from "lucide-react";
import { AmbientBackground, AppShell, Panel, PillButton, ReadingSurface, StatusTag } from "@/components/ice-mist";

const meta = "text-[13px] font-medium text-[color:var(--text-secondary)]";
const panelTitle = "text-[17px] font-semibold leading-tight";
const body = "max-w-[72ch] text-[15px] leading-[1.6]";

/** Dev-only gallery of the Ice Mist foundation components (spec §7 stage 1). Served at /dev/ice-mist. */
export function IceMistDevPage() {
  return (
    <AmbientBackground>
      <AppShell nav={<Layers aria-label="Ice Mist" className="size-6 text-[color:var(--text-primary)]" strokeWidth={1.5} />}>
        <div className="flex flex-col gap-[var(--module-gap)]">
          <header className="flex flex-col gap-2">
            <p className={meta}>Ice Mist · 阶段 1 设计基础</p>
            <h1 className="text-[30px] font-normal leading-tight">组件测试页</h1>
          </header>

          <div className="grid gap-[var(--module-gap)] lg:grid-cols-[minmax(0,1fr)_var(--aside-width)]">
            <div className="flex min-w-0 flex-col gap-[var(--module-gap)]">
              <Panel aria-labelledby="im-type" className="flex flex-col gap-4">
                <h2 className={panelTitle} id="im-type">
                  Panel · 字体层级
                </h2>
                <p className="text-[42px] font-[350] leading-[1.1] tracking-[-0.02em]">正在建立你的公司</p>
                <p className={body}>
                  正文 15px / 400，行高 1.6。面板不再叠加模糊，环境色透过外壳的模糊和面板自身的不透明度进入，边缘只用一条很轻的高光线。
                </p>
                <p className={meta}>元信息 13px / 500 · CEO Agent: Codex · 权限模式: 需要确认</p>
                <ReadingSurface className="flex flex-col gap-2">
                  <p className={meta}>ReadingSurface</p>
                  <p className={body}>
                    阅读表面用于失败原因、生成结果和长文本。它几乎不透明、没有阴影，直接放在面板内，靠色差而不是嵌套边框来分组。
                  </p>
                  <p className="im-code text-[color:var(--text-secondary)]">
                    Geist Mono · apps/dashboard/src/pages/CompanyCreationLoading.tsx · ERR_BLUEPRINT_TIMEOUT
                  </p>
                </ReadingSurface>
              </Panel>

              <Panel aria-labelledby="im-buttons" className="flex flex-col gap-4">
                <h2 className={panelTitle} id="im-buttons">
                  PillButton
                </h2>
                <div className="flex flex-wrap items-center gap-3">
                  <PillButton variant="primary">
                    <RotateCcw aria-hidden="true" />
                    重试创建
                  </PillButton>
                  <PillButton variant="secondary">返回其他公司</PillButton>
                  <PillButton disabled variant="primary">
                    主按钮（禁用）
                  </PillButton>
                  <PillButton disabled variant="secondary">
                    次按钮（禁用）
                  </PillButton>
                </div>
                <div className="flex flex-wrap items-center gap-3 border-t border-[color:var(--edge-divider)] pt-4">
                  <PillButton variant="danger">放弃创建</PillButton>
                  <span className={meta}>危险次操作与其他按钮分开放置</span>
                </div>
              </Panel>
            </div>

            <Panel aria-labelledby="im-status" className="flex flex-col gap-4">
              <h2 className={panelTitle} id="im-status">
                StatusTag
              </h2>
              <ul className="flex flex-col gap-3">
                <li className="flex items-center justify-between gap-3">
                  <StatusTag tone="success">已完成</StatusTag>
                  <span className={meta}>success</span>
                </li>
                <li className="flex items-center justify-between gap-3">
                  <StatusTag tone="failed">创建失败</StatusTag>
                  <span className={meta}>failed</span>
                </li>
                <li className="flex items-center justify-between gap-3">
                  <StatusTag tone="running">运行中</StatusTag>
                  <span className={meta}>running</span>
                </li>
                <li className="flex items-center justify-between gap-3">
                  <StatusTag tone="caution">方案已过期</StatusTag>
                  <span className={meta}>caution · 同屏最多一处</span>
                </li>
                <li className="flex items-center justify-between gap-3">
                  <StatusTag icon={Eye} tone="yourTurn">待审核</StatusTag>
                  <span className={meta}>yourTurn · Eye</span>
                </li>
                <li className="flex items-center justify-between gap-3">
                  <StatusTag tone="yourTurn">需要你处理</StatusTag>
                  <span className={meta}>yourTurn</span>
                </li>
                <li className="flex items-center justify-between gap-3 border-t border-[color:var(--edge-divider)] pt-3">
                  <StatusTag tone="queued">排队中</StatusTag>
                  <span className={meta}>queued</span>
                </li>
                <li className="flex items-center justify-between gap-3">
                  <StatusTag icon={Pause} tone="queued">已暂停</StatusTag>
                  <span className={meta}>queued · Pause</span>
                </li>
              </ul>
            </Panel>
          </div>
        </div>
      </AppShell>
    </AmbientBackground>
  );
}
