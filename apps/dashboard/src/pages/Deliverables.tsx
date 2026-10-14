import { FileText, MessageSquareText, Paperclip } from "lucide-react";
import type { BusinessArtifactSummary, ProofSummary, ReviewSummary, TaskSummary } from "../api/client";
import { Card } from "../components/ui";
import { WorkbenchSection } from "../components/workbench/WorkbenchSection";
import { KeyValueList } from "../components/workbench/KeyValueList";
import { useLanguage, type TranslationKey } from "../ui/language";
import { taskTitle } from "../ui/language/localizedNames";
import { resolveLocalizedValue } from "../ui/language/localizedText";
import {
  formatArtifactKind,
  formatArtifactReviewStatus,
  formatArtifactRole,
  formatArtifactValidationStatus,
  formatCodeLabel,
  formatProofType,
} from "../ui/tasks/formatDisplayValue";

export type DeliverablesProps = {
  businessArtifacts: BusinessArtifactSummary[];
  proof: ProofSummary[];
  reviews: ReviewSummary[];
  tasks: TaskSummary[];
};

/**
 * Every file the departments delivered, with the evidence behind it (dashboard ADR 0002). It reads
 * the company snapshot, so there is nothing to load by hand.
 */
export function Deliverables({ businessArtifacts, proof, reviews, tasks }: DeliverablesProps) {
  const { language, t } = useLanguage();
  const proofByTask = groupByTask(proof);
  const artifactsByTask = groupByTask(businessArtifacts);
  const tasksById = new Map(tasks.map((task) => [task.id, task]));
  // Blueprint order first, then any task the snapshot does not list.
  const deliveredTaskIds = [
    ...tasks.map((task) => task.id).filter((taskId) => artifactsByTask.has(taskId)),
    ...[...artifactsByTask.keys()].filter((taskId) => !tasksById.has(taskId)),
  ];
  const looseEvidence = proof.filter((item) => !artifactsByTask.has(item.taskId));
  const titleFor = (taskId: string) => {
    const task = tasksById.get(taskId);
    return task ? taskTitle(task, language) : taskId;
  };

  return (
    <div className="grid gap-4">
      <p className="text-sm text-muted-foreground">{t("deliverables.intro")}</p>

      {deliveredTaskIds.length === 0 ? (
        <Card className="p-5 text-sm text-muted-foreground">{t("deliverables.empty")}</Card>
      ) : null}

      {deliveredTaskIds.map((taskId) => {
        const artifacts = [...(artifactsByTask.get(taskId) ?? [])].sort((a, b) => Number(b.isCurrent) - Number(a.isCurrent));
        const evidence = proofByTask.get(taskId) ?? [];
        return (
          <WorkbenchSection icon={<FileText aria-hidden="true" />} key={taskId} title={titleFor(taskId)}>
            <ul className="grid gap-2">
              {artifacts.map((artifact) => (
                <li className="grid gap-1 rounded-md bg-muted/60 p-3" key={artifact.id}>
                  <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                    {formatArtifactRole(artifact.artifactRole, t)}
                    <span
                      className={
                        artifact.isCurrent
                          ? "rounded-[var(--r-pill)] bg-status-success-bg px-2 py-0.5 text-xs font-medium text-status-success"
                          : "rounded-[var(--r-pill)] bg-status-neutral-bg px-2 py-0.5 text-xs font-medium text-status-neutral"
                      }
                    >
                      {t(artifact.isCurrent ? "deliverables.current" : "deliverables.earlier")}
                    </span>
                  </p>
                  <details className="text-sm">
                    <summary className="cursor-pointer text-muted-foreground">{t("workbench.details")}</summary>
                    <KeyValueList className="mt-2" items={artifactDetails(artifact, t)} />
                  </details>
                </li>
              ))}
            </ul>
            <h3 className="text-sm font-semibold">{t("deliverables.evidence")}</h3>
            <EvidenceList evidence={evidence} language={language} t={t} />
          </WorkbenchSection>
        );
      })}

      {looseEvidence.length > 0 ? (
        <WorkbenchSection icon={<Paperclip aria-hidden="true" />} title={t("deliverables.otherEvidence")}>
          {[...groupByTask(looseEvidence)].map(([taskId, items]) => (
            <div className="grid gap-1" key={taskId}>
              <h3 className="text-sm font-semibold">{titleFor(taskId)}</h3>
              <EvidenceList evidence={items} language={language} t={t} />
            </div>
          ))}
        </WorkbenchSection>
      ) : null}

      <WorkbenchSection icon={<MessageSquareText aria-hidden="true" />} title={t("deliverables.reviews")}>
        {reviews.length === 0 ? <p className="text-sm text-muted-foreground">{t("deliverables.noReviews")}</p> : null}
        <ul className="grid gap-2 text-sm">
          {reviews.map((review) => (
            <li className="break-words" key={review.id}>
              {review.summary}
            </li>
          ))}
        </ul>
      </WorkbenchSection>
    </div>
  );
}

function EvidenceList({ evidence, language, t }: { evidence: ProofSummary[]; language: "en" | "zh"; t: (key: TranslationKey) => string }) {
  if (evidence.length === 0) {
    return <p className="text-sm text-muted-foreground">{t("deliverables.noEvidence")}</p>;
  }
  return (
    <ul className="grid gap-1.5 text-sm">
      {evidence.map((item) => (
        <li className="grid gap-0.5" key={item.id}>
          <span className="break-words">{resolveLocalizedValue(item.summaryText, language, item.summary)}</span>
          <span className="break-all text-xs text-muted-foreground">{`${formatProofType(item.type, t)} · ${item.uri}`}</span>
        </li>
      ))}
    </ul>
  );
}


function artifactDetails(artifact: BusinessArtifactSummary, t: (key: TranslationKey) => string) {
  return [
    { label: t("deliverables.detailKind"), value: formatArtifactKind(artifact.artifactKind, t) },
    { label: t("deliverables.detailSubtype"), value: formatCodeLabel(artifact.artifactSubtype) },
    { label: t("deliverables.detailValidation"), value: formatArtifactValidationStatus(artifact.validationStatus, t) },
    { label: t("deliverables.detailReview"), value: formatArtifactReviewStatus(artifact.reviewStatus, t) },
  ];
}

function groupByTask<T extends { taskId: string }>(items: T[]): Map<string, T[]> {
  const grouped = new Map<string, T[]>();
  for (const item of items) {
    grouped.set(item.taskId, [...(grouped.get(item.taskId) ?? []), item]);
  }
  return grouped;
}
