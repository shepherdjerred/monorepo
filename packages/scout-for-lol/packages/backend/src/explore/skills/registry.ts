import { DARE_V2_PROMPT_VERSION } from "@scout-for-lol/data";
import type { ExploreSurface } from "#src/explore/surface.ts";
import {
  loadExploreSkillFiles,
  type ExploreSkillFile,
} from "#src/explore/skills/loader.ts";

/**
 * The Explore skill registry: which skills exist, which are enabled for a
 * turn, and how a Markdown body becomes the text `load_skill` returns.
 *
 * Placeholders keep generated content unforked: skill bodies reference it as
 * `{{token}}` and the provider map below resolves each token at load time.
 * The ScoutQL reference is not a skill: it lives in the system prompt (see
 * `explore/scoutql-reference.ts` for why).
 */

/** Turn-independent providers, resolved lazily at load time. */
const STATIC_PLACEHOLDER_PROVIDERS: Record<string, (() => string) | undefined> =
  {
    dareV2PromptVersion: () => DARE_V2_PROMPT_VERSION,
  };

/** Per-turn providers, resolved from the skill context on every load. */
const TURN_PLACEHOLDER_NAMES = new Set(["currentTime"]);

export type ExploreSkillContext = {
  /** Non-null only for a bucks-capable turn; carries the turn's timestamp. */
  bucks: { currentTime: string } | null;
  /** Non-null only for an MVP-votes-capable turn; shares the clock token. */
  mvpVotes?: { currentTime: string } | null;
  surface: ExploreSurface;
};

/** The option shape `exploreAgentInstructions` already takes. */
export type ExploreSkillOptions = {
  bucks: { currentTime: string } | null;
  mvpVotes?: { currentTime: string } | null | undefined;
  dares?: boolean | undefined;
  challenges?: boolean | undefined;
  creation?: boolean | undefined;
  riotHistory?: boolean | undefined;
  clash?: boolean | undefined;
  hallOfFame?: boolean | undefined;
  surface?: ExploreSurface | undefined;
};

function assertKnownPlaceholders(
  skills: readonly ExploreSkillFile[],
): readonly ExploreSkillFile[] {
  for (const skill of skills) {
    for (const placeholder of skill.placeholders) {
      const known =
        STATIC_PLACEHOLDER_PROVIDERS[placeholder] !== undefined ||
        TURN_PLACEHOLDER_NAMES.has(placeholder);
      if (!known) {
        throw new Error(
          `Skill '${skill.name}' references unknown placeholder '{{${placeholder}}}'.`,
        );
      }
    }
  }
  return skills;
}

/** Every skill file, parsed and placeholder-checked at module init. */
export const EXPLORE_SKILLS: readonly ExploreSkillFile[] =
  assertKnownPlaceholders(await loadExploreSkillFiles());

export const EXPLORE_SKILL_NAMES: readonly string[] = EXPLORE_SKILLS.map(
  (skill) => skill.name,
);

/** The skills a turn with these capabilities may load. */
export function enabledExploreSkills(
  options: ExploreSkillOptions,
): readonly ExploreSkillFile[] {
  const surface = options.surface ?? "web";
  return EXPLORE_SKILLS.filter((skill) => {
    if (!skill.surfaces.includes(surface)) {
      return false;
    }
    switch (skill.capability) {
      case "always":
        return true;
      case "bucks":
        return options.bucks !== null;
      case "dares":
        return options.dares === true;
      case "challenges":
        return options.challenges === true;
      case "creation":
        return options.creation === true;
      case "riot-history":
        return options.riotHistory === true;
      case "mvp-votes":
        return options.mvpVotes != null;
      case "clash":
        return options.clash === true;
    }
  });
}

/** The `## Skills` index block for the system prompt. */
export function exploreSkillIndexSection(
  skills: readonly ExploreSkillFile[],
): string {
  return [
    "## Skills",
    "Some instructions are packaged as skills and loaded on demand instead of being written out here. Call load_skill with a skill's name to read its full instructions; each returns quickly and costs no query budget.",
    "Load a skill BEFORE using its tools or doing what it covers. Skills are not remembered between turns — load again in a new turn if you need one.",
    ...skills.map((skill) => `- ${skill.name}: ${skill.description}`),
    ...(skills.some((skill) => skill.tripwires.length > 0)
      ? [
          "These rules always apply, even before the matching skill is loaded:",
          ...skills.flatMap((skill) =>
            skill.tripwires.map((tripwire) => `- ${tripwire}`),
          ),
        ]
      : []),
  ].join("\n");
}

/** Resolve a skill's placeholders into the text `load_skill` returns. */
export function renderExploreSkillBody(
  skill: ExploreSkillFile,
  context: ExploreSkillContext,
): string {
  return skill.body.replaceAll(
    /\{\{([a-z][a-z0-9]*)\}\}/gi,
    (token, name: string) => {
      const staticProvider = STATIC_PLACEHOLDER_PROVIDERS[name];
      if (staticProvider !== undefined) {
        return staticProvider();
      }
      if (name === "currentTime") {
        const clock = context.bucks ?? context.mvpVotes ?? null;
        if (clock === null) {
          throw new Error(
            `Skill '${skill.name}' needs {{currentTime}} but the turn has no clock context.`,
          );
        }
        return clock.currentTime;
      }
      throw new Error(
        `Skill '${skill.name}' references unknown placeholder ${token}.`,
      );
    },
  );
}

/**
 * One skill's rendered body, for eval scripts — which hash this exact text
 * into their reports, so it must be the same text `load_skill(name)` returns
 * to the agent.
 */
export function exploreSkillBody(name: string): string {
  const skill = EXPLORE_SKILLS.find((candidate) => candidate.name === name);
  if (skill === undefined) {
    throw new Error(`The '${name}' skill file is missing.`);
  }
  return renderExploreSkillBody(skill, { bucks: null, surface: "web" });
}

/** The dare skill's rendered body. See `exploreSkillBody`. */
export function dareSkillBody(): string {
  return exploreSkillBody("dares");
}
