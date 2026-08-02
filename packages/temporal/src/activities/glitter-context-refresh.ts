import { mkdir, rm } from "node:fs/promises";
import { Context } from "@temporalio/activity";
import { simpleGit } from "simple-git";
import { z } from "zod/v4";
import {
  GenerationStateDocumentSchema,
  PeopleDocumentSchema,
  RelationshipsDocumentSchema,
  StyleCardSchema,
  type GenerationStateDocument,
  type GenerationStateEntry,
  type StyleCard,
} from "@shepherdjerred/glitter-context/schema";
import { createGitHubAppInstallationToken } from "#lib/github-app-token.ts";
import {
  glitterContextRefreshPeople,
  glitterContextRefreshRelationshipProposals,
  glitterContextRefreshRunsTotal,
} from "#observability/metrics-glitter.ts";
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
import { createCorpusStoreFromEnv } from "./glitter-corpus-store.ts";
import {
  openSeasonRefreshPr,
  parsePorcelainPaths,
} from "./scout-season-refresh-git.ts";
import {
  glitterContextProposalChecksum,
  glitterContextRunIdentity,
} from "./glitter-context-refresh-identity.ts";

const REPO_URL = "https://github.com/shepherdjerred/monorepo.git";
const REPO_SLUG = "shepherdjerred/monorepo";
const MAIN_BRANCH = "main";
const PACKAGE_PATH = "packages/glitter-context";

export function shouldEvaluateRelationships(
  sourceSnapshotChecksum: string | null,
  latestSnapshotChecksum: string,
): boolean {
  return sourceSnapshotChecksum !== latestSnapshotChecksum;
}

export function shouldPersistRelationshipEvaluation(input: {
  evaluated: boolean;
  refreshedPeopleCount: number;
  relationshipProposalCount: number;
}): boolean {
  return (
    input.evaluated &&
    (input.refreshedPeopleCount > 0 || input.relationshipProposalCount > 0)
  );
}

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
  await runCommand(["bun", "test"], { cwd: packageDir });
  await runCommand(["bun", "run", "lint"], { cwd: packageDir });
  await runCommand(["bun", "run", "build"], { cwd: packageDir });
}

function updateGenerationState(input: {
  state: GenerationStateDocument;
  refreshedPeople: ReadonlySet<string>;
  candidates: ReturnType<typeof selectStyleRefreshCandidates>;
  snapshotSha256: string;
  refreshedAt: string;
  relationshipsEvaluated: boolean;
}): GenerationStateDocument {
  const candidateByPerson = new Map(
    input.candidates.map((candidate) => [candidate.person.id, candidate]),
  );
  const refreshedEntryFor = (personId: string): GenerationStateEntry => {
    const candidate = candidateByPerson.get(personId);
    const lastMessage = candidate?.messages.at(-1);
    if (candidate === undefined || lastMessage === undefined) {
      throw new Error(`missing refreshed candidate state for ${personId}`);
    }
    return {
      personId,
      lastMessageId: lastMessage.messageId,
      sourceSnapshotChecksum: input.snapshotSha256,
      messageCount: candidate.totalMessageCount,
      refreshedAt: input.refreshedAt,
    };
  };
  const existingPersonIds = new Set(
    input.state.people.map((entry) => entry.personId),
  );
  const updatedExisting = input.state.people.map((entry) =>
    input.refreshedPeople.has(entry.personId)
      ? { ...entry, ...refreshedEntryFor(entry.personId) }
      : entry,
  );
  // A person can become a refresh candidate without a pre-existing state entry
  // (new Discord ID + style card). Without appending their watermark here, every
  // later weekly run would treat them as never-refreshed and regenerate their
  // card from the entire corpus. Record state for those newly refreshed people.
  const appended = [...input.refreshedPeople]
    .filter((personId) => !existingPersonIds.has(personId))
    .toSorted()
    .map((personId) => refreshedEntryFor(personId));
  return GenerationStateDocumentSchema.parse({
    ...input.state,
    relationshipSourceSnapshotChecksum: input.relationshipsEvaluated
      ? input.snapshotSha256
      : input.state.relationshipSourceSnapshotChecksum,
    relationshipRefreshedAt: input.relationshipsEvaluated
      ? input.refreshedAt
      : input.state.relationshipRefreshedAt,
    people: [...updatedExisting, ...appended],
  });
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
        const card = await generateStyleCard({
          candidate,
          existingCard,
          sourceSnapshotSha256: corpus.reference.snapshotSha256,
          artifactStore: generationArtifactStore,
          budget: generationBudget,
        });
        await Bun.write(path, jsonText(card));
        refreshedPeople.add(candidate.person.id);
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
