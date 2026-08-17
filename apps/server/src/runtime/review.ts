import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { createRepositories } from "../db/repositories";

export type RunCompanyReviewInput = {
  projectRoot: string;
  companyId: string;
  repositories: ReturnType<typeof createRepositories>;
  now?: () => Date;
  createId?: (prefix: string) => string;
};

export type RunCompanyReviewResult = {
  reviewId: string;
  reviewPath: string;
  completedTasks: string[];
  missingProofTasks: string[];
};

export function runCompanyReview(input: RunCompanyReviewInput): RunCompanyReviewResult {
  const now = input.now ?? (() => new Date());
  const createId = input.createId ?? defaultCreateId;
  const reviewId = createId("review");
  const createdAt = now().toISOString();
  const tasks = input.repositories
    .listTasksForCompany(input.companyId)
    .filter((task) => task.status === "review");
  const completedTasks: string[] = [];
  const missingProofTasks: string[] = [];
  const proofSummaries: string[] = [];

  for (const task of tasks) {
    const proofs = input.repositories.listProofsForTask(task.id);

    if (proofs.length === 0) {
      missingProofTasks.push(task.id);
      if (task.keyResultId) {
        raiseObjectivePriorityForKeyResult(input.repositories, input.companyId, task.keyResultId);
      }
      continue;
    }

    input.repositories.updateTaskStatus(task.id, "complete");
    completedTasks.push(task.id);
    proofSummaries.push(...proofs.map((proof) => `- ${task.title}: ${proof.summary}`));

    if (task.keyResultId) {
      input.repositories.updateKeyResultProgress(task.keyResultId, "proof_received", "met");
    }
  }

  const reviewPath = writeReviewMarkdown({
    projectRoot: input.projectRoot,
    companyId: input.companyId,
    reviewId,
    createdAt,
    completedTasks,
    missingProofTasks,
    proofSummaries,
  });
  const summary = `Completed ${completedTasks.length} task(s), ${missingProofTasks.length} missing proof.`;

  input.repositories.createReview({
    id: reviewId,
    companyId: input.companyId,
    summary,
    reviewPath,
    createdAt,
  });

  return {
    reviewId,
    reviewPath,
    completedTasks,
    missingProofTasks,
  };
}

function raiseObjectivePriorityForKeyResult(
  repositories: ReturnType<typeof createRepositories>,
  companyId: string,
  keyResultId: string,
): void {
  const keyResults = repositories.listKeyResults(companyId);
  const keyResult = keyResults.find((candidate) => candidate.id === keyResultId);

  if (!keyResult) {
    return;
  }

  const objectives = repositories.listObjectives(companyId);
  const objective = objectives.find((candidate) => candidate.id === keyResult.objectiveId);

  if (!objective) {
    return;
  }

  repositories.updateObjectivePriority(objective.id, Math.max(0, objective.priority - 1));
}

function writeReviewMarkdown(input: {
  projectRoot: string;
  companyId: string;
  reviewId: string;
  createdAt: string;
  completedTasks: string[];
  missingProofTasks: string[];
  proofSummaries: string[];
}): string {
  const reviewDir = join(input.projectRoot, ".auto-crop", "companies", input.companyId, "reviews");
  mkdirSync(reviewDir, { recursive: true });
  const reviewPath = join(reviewDir, `${input.reviewId}.md`);
  const content = [
    `# Review ${input.reviewId}`,
    "",
    `Created: ${input.createdAt}`,
    "",
    "## Completed Tasks",
    ...(input.completedTasks.length > 0 ? input.completedTasks.map((taskId) => `- ${taskId}`) : ["- None"]),
    "",
    "## Missing Proof Tasks",
    ...(input.missingProofTasks.length > 0 ? input.missingProofTasks.map((taskId) => `- ${taskId}`) : ["- None"]),
    "",
    "## Proof",
    ...(input.proofSummaries.length > 0 ? input.proofSummaries : ["- None"]),
    "",
  ].join("\n");
  writeFileSync(reviewPath, content, "utf8");
  return reviewPath;
}

function defaultCreateId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID()}`;
}
