import { z } from "zod";
import { ExploreSurfaceSchema } from "#src/explore/surface.ts";

/**
 * Parsing for the Markdown skill files in `content/`.
 *
 * Adding a skill is adding one `.md` file: the loader discovers files by
 * directory listing, so no registration list exists to forget. Everything
 * here fails loudly at module init — a malformed skill file is a broken
 * internal contract, not user input, and the worst outcome would be a skill
 * silently missing from the agent's index.
 */

export const EXPLORE_SKILL_CAPABILITIES = [
  "always",
  "bucks",
  "dares",
  "challenges",
  "creation",
  "riot-history",
  "mvp-votes",
  "clash",
] as const;

export const ExploreSkillCapabilitySchema = z.enum(EXPLORE_SKILL_CAPABILITIES);
export type ExploreSkillCapability = z.infer<
  typeof ExploreSkillCapabilitySchema
>;

const ExploreSkillFrontmatterSchema = z.strictObject({
  name: z
    .string()
    .regex(/^[a-z][a-z0-9-]*$/, "skill names are kebab-case identifiers"),
  description: z.string().min(1),
  capability: ExploreSkillCapabilitySchema,
  surfaces: z.array(ExploreSurfaceSchema).min(1),
  /** Rules that hold even when the body is never loaded; rendered in core. */
  tripwires: z.array(z.string().min(1)).max(4),
});

export type ExploreSkillFile = z.infer<typeof ExploreSkillFrontmatterSchema> & {
  /** Raw Markdown body, placeholders unresolved. */
  body: string;
  /** `{{name}}` tokens found in the body, deduplicated. */
  placeholders: readonly string[];
};

const PLACEHOLDER_PATTERN = /\{\{([a-z][a-z0-9]*)\}\}/gi;

export function parseExploreSkillFile(
  fileName: string,
  raw: string,
): ExploreSkillFile {
  const match = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(raw);
  if (match === null) {
    throw new Error(
      `Skill file ${fileName} must start with a --- YAML frontmatter block.`,
    );
  }
  const [, frontmatterText, rawBody] = match;
  if (frontmatterText === undefined || rawBody === undefined) {
    throw new Error(`Skill file ${fileName} has an empty frontmatter or body.`);
  }
  const frontmatter = ExploreSkillFrontmatterSchema.parse(
    Bun.YAML.parse(frontmatterText),
  );
  const body = rawBody.trim();
  if (body.length === 0) {
    throw new Error(`Skill file ${fileName} has an empty body.`);
  }
  const placeholders = [
    ...new Set(
      [...body.matchAll(PLACEHOLDER_PATTERN)].map((token) => token[1] ?? ""),
    ),
  ];
  return { ...frontmatter, body, placeholders };
}

// Resolved at runtime, so the directory must sit next to the executing code:
// in the source tree that is this file's own `content/`, and in the bundled
// artifact the package build copies `content/` into `dist/` (the bundle's
// `import.meta.dir`). A bundle without it fails loudly at module init below.
const CONTENT_DIR = `${import.meta.dir}/content`;

/** Every skill file, sorted by name for a deterministic prompt index. */
export async function loadExploreSkillFiles(): Promise<
  readonly ExploreSkillFile[]
> {
  const files = [...new Bun.Glob("*.md").scanSync(CONTENT_DIR)].sort();
  if (files.length === 0) {
    throw new Error(`No skill files found in ${CONTENT_DIR}.`);
  }
  const skills = await Promise.all(
    files.map(async (fileName) =>
      parseExploreSkillFile(
        fileName,
        await Bun.file(`${CONTENT_DIR}/${fileName}`).text(),
      ),
    ),
  );
  const names = new Set<string>();
  for (const skill of skills) {
    if (names.has(skill.name)) {
      throw new Error(
        `Duplicate skill name '${skill.name}' in ${CONTENT_DIR}.`,
      );
    }
    names.add(skill.name);
  }
  return skills.toSorted((a, b) => a.name.localeCompare(b.name));
}
