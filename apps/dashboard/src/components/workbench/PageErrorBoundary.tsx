import { AlertTriangle, RotateCw } from "lucide-react";
import { Component, type ErrorInfo, type ReactNode } from "react";
import { Button, Card } from "@/components/ui";
import { useLanguage } from "../../ui/language";

type Props = {
  children: ReactNode;
  /** The page this boundary guards; opening another page starts it afresh. */
  resetKey: string;
};

type State = { error: Error | null; resetKey: string };

/**
 * Contains a render crash to the Workbench page it happened on, so the rail and header stay usable
 * and the founder can retry or go elsewhere instead of facing a blank window.
 */
export class PageErrorBoundary extends Component<Props, State> {
  state: State = { error: null, resetKey: this.props.resetKey };

  static getDerivedStateFromProps(props: Props, state: State): Partial<State> | null {
    return props.resetKey !== state.resetKey ? { error: null, resetKey: props.resetKey } : null;
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`[PageErrorBoundary] "${this.props.resetKey}" crashed`, error, info.componentStack);
  }

  render() {
    if (!this.state.error) {
      return this.props.children;
    }
    return <PageCrashed error={this.state.error} onRetry={() => this.setState({ error: null })} />;
  }
}

function PageCrashed({ error, onRetry }: { error: Error; onRetry(): void }) {
  const { t } = useLanguage();

  return (
    <Card className="grid content-start gap-3 p-5" role="alert">
      <h2 className="flex items-center gap-2 text-sm font-semibold">
        <AlertTriangle aria-hidden="true" className="size-4 text-status-failed-icon" />
        {t("workbench.pageCrashed")}
      </h2>
      <p className="text-sm text-muted-foreground">{t("workbench.pageCrashedBody")}</p>
      <details className="text-sm">
        <summary className="cursor-pointer text-muted-foreground">{t("workbench.details")}</summary>
        <pre className="mt-2 whitespace-pre-wrap break-words rounded-md bg-muted p-2 text-xs">{error.message || String(error)}</pre>
      </details>
      <div>
        <Button onClick={onRetry} variant="outline">
          <RotateCw aria-hidden="true" />
          {t("workbench.retry")}
        </Button>
      </div>
    </Card>
  );
}
