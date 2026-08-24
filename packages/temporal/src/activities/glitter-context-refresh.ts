import { mkdir, rm } from "node:fs/promises";
import { Context } from "@temporalio/activity";
import { simpleGit } from "simple-git";
import { z } from "zod/v4";
import {
  GenerationStateDocumentSchema,
  PeopleDocumentSchema,
  RelationshipsDocumentSchema,
  StyleCardSchema,
  type StyleCard,
} from "@shepherdjerred/glitter-context/schema";
import { createGitHubAppInstallationToken } from "#lib/github-app-token.ts";
import {
  glitterContextRefreshPeople,
  glitterContextRefreshRelationshipProposals,
  glitterContextRefreshRunsTotal,
} from "#observability/metrics-glitter.ts";
import { log } from "#observability/log.ts";
import { parsePorcelainPaths } from "#shared/porcelain.ts";
import { rootInstallWithoutHooks } from "./bot-clone.ts";
import { runCommand } from "./data-dragon-shell.ts";
import {
  GlitterCorpusSnapshotPinSchema,
  loadVerifiedGlitterCorpus,
} from "./glitter-context-refresh-corpus.ts";
import {
  estimateRelationshipGenerationCost,
  proposeRelationships,
} from "./glitter-context-refresh-generate.ts";
import { GlitterEvidenceError } from "./glitter-context-refresh-evidence-error.ts";
import {
  estimateStyleGenerationCost,
  generateStyleCard,
} from "./glitter-context-refresh-style-generation.ts";
import { createCorpusGenerationArtifactStore } from "./glitter-context-refresh-cache.ts";
import {
  GenerationBudget,
  type GenerationBudgetSummary,
} from "./glitter-context-refresh-budget.ts";
import {
  applyRelationshipProposals,
  selectRelationshipEvidence,
} from "./glitter-context-refresh-relationships.ts";
import {
  GLITTER_GENERATION_STATE_PATH,
  GLITTER_PEOPLE_PATH,
  GLITTER_RELATIONSHIPS_PATH,
  isAllowedGlitterContextRefreshPath,
} from "./glitter-context-refresh-paths.ts";
import { selectStyleRefreshCandidates } from "./glitter-context-refresh-selection.ts";
import {
  shouldEvaluateRelationships,
  shouldFailRefreshRun,
  shouldPersistRelationshipEvaluation,
  updateGenerationState,
} from "./glitter-context-refresh-state.ts";
import { createCorpusStoreFromEnv } from "./glitter-corpus-store.ts";
import { openSeasonRefreshPr } from "./scout-season-refresh-git.ts";
import {
  glitterContextProposalChecksum,
  glitterContextRunIdentity,
} from "./glitter-context-refresh-identity.ts";

const REPO_URL = "https://github.com/shepherdjerred/monorepo.git";
const REPO_SLUG = "shepherdjerred/monorepo";
const MAIN_BRANCH = "main";
const PACKAGE_PATH = "packages/glitter-context";

export const GlitterContextRefreshInputSchema = z
  .object({
    dryRun: z.boolean().default(false),
    maxEstimatedCostUsd: z.number().positive().default(10),
    now: z.iso.datetime({ offset: true }).optional(),
    snapshot: GlitterCorpusSnapshotPinSchema.optional(),
  })
  .strict();
export type GlitterContextRefreshInput = z.input<
  typeof GlitterContextRefreshInputSchema
>;

export type GlitterContextRefreshResult = {
  outcome: "pr-created" | "no-diff" | "dry-run";
  snapshotId: string;
  snapshotSha256: string;
  proposalSha256: string;
  eligiblePeople: string[];
  refreshedPeople: string[];
  /**
   * Eligible people whose card could not be regenerated this run, with the
   * reason. The run still refreshes everyone else and opens its PR.
   */
  skippedPeople: { personId: string; reason: string }[];
  relationshipProposalCount: number;
  generation: GenerationBudgetSummary;
  changedFiles: string[];
  branchName: string | undefined;
  commitHash: string | undefined;
  prUrl: string | undefined;
};

function jsonText(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

async function readJson(path: string): Promise<unknown> {
  return await Bun.file(path).json();
}

function styleCardPath(repoDir: string, personId: string): string {
  return `${repoDir}/${PACKAGE_PATH}/data/style-cards/${personId}_style.json`;
}

async function changedFiles(repoDir: string): Promise<string[]> {
  const status = await runCommand(["git", "status", "--porcelain"], {
    cwd: repoDir,
    trimStdout: false,
  });
  const files = parsePorcelainPaths(status);
  const outsideScope = files.filter(
    (path) => !isAllowedGlitterContextRefreshPath(path),
  );
  if (outsideScope.length > 0) {
    throw new Error(
      `Glitter context refresh changed disallowed paths: ${outsideScope.join(", ")}`,
    );
  }
  return files.toSorted();
}

async function changedFileProposalChecksum(
  repoDir: string,
  files: readonly string[],
): Promise<string> {
  return glitterContextProposalChecksum(
    await Promise.all(
      files.map(async (path) => {
        const file = Bun.file(`${repoDir}/${path}`);
        return {
          path,
          bytes: (await file.exists())
            ? new Uint8Array(await file.arrayBuffer())
            : null,
        };
      }),
    ),
  );
}

async function validateRefreshClone(repoDir: string): Promise<void> {
  const packageDir = `${repoDir}/${PACKAGE_PATH}`;
  await runCommand(["bun", "run", "scripts/generate.ts"], { cwd: packageDir });
  await runCommand(
    ["bunx", "prettier", "--write", "data", "src/generated-data.ts"],
    {
      cwd: packageDir,
    },
  );
  await runCommand(["bun", "run", "typecheck"], { cwd: packageDir });
  await runCommand(["bun", "run", "test"], { cwd: packageDir });
  await runCommand(["bun", "run", "lint"], { cwd: packageDir });
  await runCommand(["bun", "run", "build"], { cwd: packageDir });
}

export type GlitterContextRefreshActivities =
  typeof glitterContextRefreshActivities;

export const glitterContextRefreshActivities = {
  async refreshGlitterContext(
    rawInput: GlitterContextRefreshInput = {},
  ): Promise<GlitterContextRefreshResult> {
    const input = GlitterContextRefreshInputSchema.parse(rawInput);
    const refreshedAt = input.now ?? new Date().toISOString();
    const now = new Date(refreshedAt);
    const workflowExecution = Context.current().info.workflowExecution;
    if (workflowExecution === undefined) {
      throw new Error(
        "Glitter context refresh requires a Temporal workflow execution",
      );
    }
    const identity = glitterContextRunIdentity(workflowExecution.runId);
    const { runId, tempDir } = identity;
    const repoDir = `${tempDir}/monorepo`;
    const heartbeat = setInterval(() => {
      Context.current().heartbeat({
        phase: "glitter-context-refresh",
        runId,
      });
    }, 10_000);

    try {
      const corpus = await loadVerifiedGlitterCorpus(input.snapshot);
      const generationArtifactStore = createCorpusGenerationArtifactStore(
        createCorpusStoreFromEnv(),
        runId,
      );
      await mkdir(tempDir, { recursive: true });
      await simpleGit().clone(REPO_URL, repoDir, [
        "--branch",
        MAIN_BRANCH,
        "--single-branch",
        "--filter=blob:none",
        "--depth=1",
      ]);
      await rootInstallWithoutHooks(repoDir);

      const peopleDocument = PeopleDocumentSchema.parse(
        await readJson(`${repoDir}/${GLITTER_PEOPLE_PATH}`),
      );
      const relationshipsDocument = RelationshipsDocumentSchema.parse(
        await readJson(`${repoDir}/${GLITTER_RELATIONSHIPS_PATH}`),
      );
      const generationState = GenerationStateDocumentSchema.parse(
        await readJson(`${repoDir}/${GLITTER_GENERATION_STATE_PATH}`),
      );
      const candidates = selectStyleRefreshCandidates({
        people: peopleDocument.people,
        state: generationState.people,
        messages: corpus.messages,
        now,
      });
      glitterContextRefreshPeople.set({ state: "eligible" }, candidates.length);
      const existingCards = new Map<string, StyleCard>();
      for (const candidate of candidates) {
        existingCards.set(
          candidate.person.id,
          StyleCardSchema.parse(
            await readJson(styleCardPath(repoDir, candidate.person.id)),
          ),
        );
      }
      const relationshipsEvaluated = shouldEvaluateRelationships(
        generationState.relationshipSourceSnapshotChecksum,
        corpus.reference.snapshotSha256,
      );
      const relationshipEvidence = relationshipsEvaluated
        ? selectRelationshipEvidence({
            people: peopleDocument.people,
            messages: corpus.messages,
          })
        : [];
      const relationshipGenerationInput = {
        people: peopleDocument.people.map((person) => ({
          id: person.id,
          displayName: person.displayName,
        })),
        currentRelationships: relationshipsDocument.events.filter(
          (event) => event.status === "current",
        ),
        evidence: relationshipEvidence,
      };
      const generationBudget = new GenerationBudget(input.maxEstimatedCostUsd);
      const stylePreflightCost = candidates.reduce((total, candidate) => {
        const existingCard = existingCards.get(candidate.person.id);
        if (existingCard === undefined) {
          throw new Error(
            `missing existing style card for ${candidate.person.id}`,
          );
        }
        return (
          total +
          estimateStyleGenerationCost({
            candidate,
            existingCard,
          })
        );
      }, 0);
      generationBudget.setPreflightEstimatedCostUsd(
        stylePreflightCost +
          estimateRelationshipGenerationCost(relationshipGenerationInput),
      );

      const refreshedPeople = new Set<string>();
      const skippedPeople: { personId: string; reason: string }[] = [];
      for (const candidate of candidates) {
        Context.current().heartbeat({
          phase: "style-card",
          personId: candidate.person.id,
        });
        const path = styleCardPath(repoDir, candidate.person.id);
        const existingCard = existingCards.get(candidate.person.id);
        if (existingCard === undefined) {
          throw new Error(
            `missing existing style card for ${candidate.person.id}`,
          );
        }
        // One person's evidence failing must not discard every other person's
        // work. A refresh is hours long and costs real money, and a single
        // chunk the model cannot summarize used to fail the whole activity —
        // including cards already generated earlier in this same loop.
        try {
          const card = await generateStyleCard({
            candidate,
            existingCard,
            sourceSnapshotSha256: corpus.reference.snapshotSha256,
            artifactStore: generationArtifactStore,
            budget: generationBudget,
          });
          await Bun.write(path, jsonText(card));
          refreshedPeople.add(candidate.person.id);
        } catch (error: unknown) {
          // Skip on `GlitterEvidenceError` and nothing else. That type means the
          // model would not produce a usable card from this person's corpus,
          // which a retry would only reproduce from the same cached artifacts.
          // Everything else keeps escaping so Temporal's activity retry can
          // recover it: a transient S3 read inside the artifact cache, a failed
          // write, a cancellation, or an exhausted budget are all about the run,
          // and swallowing one would turn a recoverable blip into a stale card
          // behind a PR that looks complete.
          if (!(error instanceof GlitterEvidenceError)) {
            throw error;
          }
          const reason = error.message;
          log("warning", "Glitter style card skipped", {
            personId: candidate.person.id,
            reason,
          });
          skippedPeople.push({ personId: candidate.person.id, reason });
        }
      }
      glitterContextRefreshPeople.set(
        { state: "skipped" },
        skippedPeople.length,
      );
      if (
        shouldFailRefreshRun({
          candidateCount: candidates.length,
          refreshedCount: refreshedPeople.size,
        })
      ) {
        throw new Error(
          `every eligible person failed to refresh (${skippedPeople.map((skipped) => `${skipped.personId}: ${skipped.reason}`).join("; ")})`,
        );
      }

      let updatedRelationships = relationshipsDocument;
      let relationshipProposalCount = 0;
      if (relationshipsEvaluated) {
        const proposals = await proposeRelationships({
          ...relationshipGenerationInput,
          artifactStore: generationArtifactStore,
          budget: generationBudget,
        });
        const applied = applyRelationshipProposals({
          document: relationshipsDocument,
          proposals,
          people: peopleDocument.people,
          evidence: relationshipEvidence,
          snapshotSha256: corpus.reference.snapshotSha256,
          recordedAt: refreshedAt,
        });
        updatedRelationships = applied.document;
        relationshipProposalCount = applied.appliedCount;
        if (relationshipProposalCount > 0) {
          await Bun.write(
            `${repoDir}/${GLITTER_RELATIONSHIPS_PATH}`,
            jsonText(updatedRelationships),
          );
        }
      }

      const persistRelationshipEvaluation = shouldPersistRelationshipEvaluation(
        {
          evaluated: relationshipsEvaluated,
          refreshedPeopleCount: refreshedPeople.size,
          relationshipProposalCount,
        },
      );
      const updatedState = updateGenerationState({
        state: generationState,
        refreshedPeople,
        candidates,
        snapshotSha256: corpus.reference.snapshotSha256,
        refreshedAt,
        relationshipsEvaluated: persistRelationshipEvaluation,
      });
      await Bun.write(
        `${repoDir}/${GLITTER_GENERATION_STATE_PATH}`,
        jsonText(updatedState),
      );
      await validateRefreshClone(repoDir);
      const files = await changedFiles(repoDir);
      const proposalSha256 = await changedFileProposalChecksum(repoDir, files);
      glitterContextRefreshPeople.set(
        { state: "refreshed" },
        refreshedPeople.size,
      );
      glitterContextRefreshRelationshipProposals.set(relationshipProposalCount);

      const baseResult = {
        snapshotId: corpus.reference.snapshotId,
        snapshotSha256: corpus.reference.snapshotSha256,
        proposalSha256,
        eligiblePeople: candidates.map((candidate) => candidate.person.id),
        refreshedPeople: [...refreshedPeople].toSorted(),
        skippedPeople,
        relationshipProposalCount,
        generation: generationBudget.summary(),
        changedFiles: files,
      };
      if (files.length === 0) {
        glitterContextRefreshRunsTotal.inc({ outcome: "no-diff" });
        return {
          ...baseResult,
          outcome: "no-diff",
          branchName: undefined,
          commitHash: undefined,
          prUrl: undefined,
        };
      }
      if (input.dryRun) {
        glitterContextRefreshRunsTotal.inc({ outcome: "dry-run" });
        return {
          ...baseResult,
          outcome: "dry-run",
          branchName: undefined,
          commitHash: undefined,
          prUrl: undefined,
        };
      }

      const { token } = await createGitHubAppInstallationToken();
      const { branch } = identity;
      const title = "chore(glitter-context): refresh verified Discord context";
      const body = [
        "Automated weekly Glitter context refresh from Temporal.",
        "",
        `Verified snapshot: \`${corpus.reference.snapshotSha256}\``,
        `Style cards refreshed: ${String(refreshedPeople.size)}`,
        // A reviewer has to be told which people this PR does NOT refresh;
        // otherwise a silently skipped card looks like one with no new evidence.
        ...(skippedPeople.length === 0
          ? []
          : [
              `Style cards skipped: ${String(skippedPeople.length)}`,
              ...skippedPeople.map(
                (skipped) => `- \`${skipped.personId}\`: ${skipped.reason}`,
              ),
            ]),
        `Relationship updates proposed: ${String(relationshipProposalCount)}`,
        `Uncached generation cost: $${baseResult.generation.actualUncachedCostUsd.toFixed(4)} / $${baseResult.generation.maxUncachedCostUsd.toFixed(2)}`,
        `Generation cache: ${String(baseResult.generation.cacheHits)} hits, ${String(baseResult.generation.cacheMisses)} misses`,
        "",
        "The model received only bounded, attachment-free, mention-free,",
        "URL-free corpus samples. Relationship changes cite exact message IDs.",
        "This PR requires human review and is never auto-merged.",
        "",
        "Changed files:",
        ...files.map((file) => `- \`${file}\``),
      ].join("\n");
      const { commitHash, prUrl } = await openSeasonRefreshPr({
        repoDir,
        tempDir,
        branch,
        title,
        body,
        files,
        ghToken: token,
        repoSlug: REPO_SLUG,
        mainBranch: MAIN_BRANCH,
      });
      glitterContextRefreshRunsTotal.inc({ outcome: "pr-created" });
      return {
        ...baseResult,
        outcome: "pr-created",
        branchName: branch,
        commitHash,
        prUrl,
      };
    } catch (error: unknown) {
      glitterContextRefreshRunsTotal.inc({ outcome: "failed" });
      throw error;
    } finally {
      clearInterval(heartbeat);
      await rm(tempDir, { recursive: true, force: true });
    }
  },
};
