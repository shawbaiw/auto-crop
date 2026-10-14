import { FileText, History, MessageSquareText, Paperclip } from "lucide-react";
import type { BusinessArtifactSummary, ProofSummary, ReviewSummary, TaskSummary } from "../api/client";
import { StatusTag } from "../components/ice-mist";
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
      <p className="max-w-[72ch] text-[15px] leading-relaxed text-foreground">{t("deliverables.intro")}</p>

      {deliveredTaskIds.length === 0 ? (
        <p className="rounded-[var(--r-reading)] bg-[color:var(--surface-reading)] px-4 py-3 text-[15px] text-muted-foreground">{t("deliverables.empty")}</p>
      ) : null}

      {deliveredTaskIds.map((taskId) => {
        const artifacts = [...(artifactsByTask.get(taskId) ?? [])].sort((a, b) => Number(b.isCurrent) - Number(a.isCurrent));
        const evidence = proofByTask.get(taskId) ?? [];
        return (
          <WorkbenchSection icon={<FileText aria-hidden="true" />} key={taskId} title={titleFor(taskId)}>
            <ul className="grid gap-2">
              {artifacts.map((artifact) => (
                <li className="grid gap-1.5 rounded-[var(--r-reading)] bg-[color:var(--surface-reading)] px-4 py-3" key={artifact.id}>
                  <p className="flex flex-wrap items-center gap-2 text-[15px] font-medium">
                    {formatArtifactRole(artifact.artifactRole, t)}
                    <StatusTag icon={artifact.isCurrent ? undefined : History} tone={artifact.isCurrent ? "success" : "queued"}>
                      {t(artifact.isCurrent ? "deliverables.current" : "deliverables.earlier")}
                    </StatusTag>
                  </p>
                  <details className="text-[13px]">
                    <summary className="cursor-pointer text-muted-foreground">{t("workbench.details")}</summary>
                    <KeyValueList className="mt-2 text-[13px]" items={artifactDetails(artifact, t)} />
                  </details>
                </li>
              ))}
            </ul>
            <h3 className="text-[13px] font-medium normal-case text-muted-foreground">{t("deliverables.evidence")}</h3>
            <EvidenceList evidence={evidence} language={language} t={t} />
          </WorkbenchSection>
        );
      })}

      {looseEvidence.length > 0 ? (
        <WorkbenchSection icon={<Paperclip aria-hidden="true" />} title={t("deliverables.otherEvidence")}>
          {[...groupByTask(looseEvidence)].map(([taskId, items]) => (
            <div className="grid gap-1" key={taskId}>
              <h3 className="text-[15px] font-semibold normal-case">{titleFor(taskId)}</h3>
              <EvidenceList evidence={items} language={language} t={t} />
            </div>
          ))}
        </WorkbenchSection>
      ) : null}

      <WorkbenchSection icon={<MessageSquareText aria-hidden="true" />} title={t("deliverables.reviews")}>
        {reviews.length === 0 ? <p className="text-[15px] text-muted-foreground">{t("deliverables.noReviews")}</p> : null}
        <ul className="grid max-w-[72ch] gap-2 text-[15px] leading-relaxed">
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
    return <p className="text-[15px] text-muted-foreground">{t("deliverables.noEvidence")}</p>;
  }
  return (
    <ul className="grid max-w-[72ch] gap-2 text-[15px] leading-relaxed">
      {evidence.map((item) => (
        <li className="grid gap-0.5" key={item.id}>
          <span className="break-words">{resolveLocalizedValue(item.summaryText, language, item.summary)}</span>
          <span className="text-[13px] text-muted-foreground">
            {formatProofType(item.type, t)} · <span className="im-code">{item.uri}</span>
          </span>
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
