import type { BusinessArtifactSummary, CeoOfficeItemSummary, ProofSummary } from "../../api/client";
import { Button, Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui";
import type { WorkspaceHandlers } from "../workbench/workspaceHandlers";
import { KeyValueList } from "../workbench/KeyValueList";
import { useLanguage } from "../../ui/language";
import { departmentName } from "../../ui/language/localizedNames";
import type { CeoOfficeView } from "./CeoOfficeCard";
import { DecisionPanel } from "./DecisionPanel";
import { EvidenceDetails } from "./EvidenceDetails";
import { HumanActionPanel } from "./HumanActionPanel";
import { ReviewPanel } from "./ReviewPanel";
import { formatCeoOfficeItemType, timelineItemView } from "./timelineItemView";

export type CeoOfficeActions = Pick<WorkspaceHandlers, "onCreateCeoReviewDecision" | "onResolveFounderDecision" | "onConfirmHumanAction">;

/**
 * The full detail behind a card, and the one place the founder acts on it: a review, a decision or a
 * Human Action. Timeline cards and "Needs you" cards open the same dialog, so an action has one form.
 */
export function CeoOfficeItemDialog({
  actions,
  businessArtifacts,
  item,
  onActed,
  onClose,
  proofs,
  view,
}: {
  actions: CeoOfficeActions;
  businessArtifacts: BusinessArtifactSummary[];
  item: CeoOfficeItemSummary | null;
  onActed(message: string): void;
  onClose(): void;
  proofs: ProofSummary[];
  view: CeoOfficeView;
}) {
  return (
    <Dialog open={item !== null} onOpenChange={(open) => (open ? undefined : onClose())}>
      {item ? <DialogBody actions={actions} businessArtifacts={businessArtifacts} item={item} key={item.id} onActed={onActed} proofs={proofs} view={view} /> : null}
    </Dialog>
  );
}

function DialogBody(props: {
  actions: CeoOfficeActions;
  businessArtifacts: BusinessArtifactSummary[];
  item: CeoOfficeItemSummary;
  onActed(message: string): void;
  proofs: ProofSummary[];
  view: CeoOfficeView;
}) {
  const { t } = useLanguage();
  const { ctx } = props.view;
  const current = props.item;
  const detail = timelineItemView(current, ctx);
  const department = current.departmentId ? props.view.departmentsById.get(current.departmentId) : undefined;
  const task = current.taskId ? ctx.tasksById.get(current.taskId) : undefined;
  return (
    <DialogContent closeLabel={t("ceoOffice.close")}>
      <div className="grid gap-1">
        <p className="text-xs font-medium text-muted-foreground">
          {[formatCeoOfficeItemType(current.type, t), department ? departmentName(department, ctx.locale) : null, new Date(current.occurredAt).toLocaleString(ctx.locale)]
            .filter(Boolean)
            .join(" · ")}
        </p>
        <DialogTitle>{ctx.localize(current.titleText, current.title)}</DialogTitle>
        <DialogDescription className="text-sm text-foreground/80">{detail.keyLine}</DialogDescription>
      </div>
      {current.type === "approval_request" && task ? (
        <ReviewPanel businessArtifacts={props.businessArtifacts} onDecided={props.onActed} onDecision={props.actions.onCreateCeoReviewDecision} proofs={props.proofs} task={task} />
      ) : null}
      {current.type === "decision_request" ? <DecisionPanel item={current} onDecided={props.onActed} onResolve={props.actions.onResolveFounderDecision} /> : null}
      {current.type === "human_action" ? <HumanActionPanel item={current} onConfirm={props.actions.onConfirmHumanAction} onDone={props.onActed} /> : null}
      {detail.rows.length > 0 ? <KeyValueList items={detail.rows} /> : null}
      {current.type !== "approval_request" && (props.proofs.length > 0 || props.businessArtifacts.length > 0) ? (
        <EvidenceDetails businessArtifacts={props.businessArtifacts} proofs={props.proofs} />
      ) : null}
      {department ? (
        <Button className="justify-self-start" onClick={() => props.view.onOpenDepartment(department.id)} size="sm" variant="outline">
          {t("ceoOffice.openDepartmentPage")}
        </Button>
      ) : null}
    </DialogContent>
  );
}
