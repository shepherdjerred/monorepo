/**
 * `toolkit mc build library …`: browse mc-build's curated programs and copy one
 * into a build directory as its build.ts.
 */
import {
  findLibraryEntry,
  listLibrary,
  searchLibrary,
  type LibraryEntry,
} from "@shepherdjerred/mc-build/library/library.ts";
import { BUILD_FILES } from "#protocol/build.ts";
import { PROGRAM_TEMPLATE } from "./commands.ts";
import { BuildWorkspace } from "./workspace.ts";

export type LibraryRow = {
  slug: string;
  title: string;
  style: string;
  tags: string[];
  footprint: { w: number; d: number; h: number };
};

function row(entry: LibraryEntry): LibraryRow {
  return {
    slug: entry.slug,
    title: entry.meta.title,
    style: entry.meta.style,
    tags: entry.meta.tags,
    footprint: entry.meta.footprint,
  };
}

export async function libraryList(query: {
  tags: readonly string[];
  text?: string;
}): Promise<LibraryRow[]> {
  const entries =
    query.tags.length === 0 && query.text === undefined
      ? await listLibrary()
      : await searchLibrary(query);
  return entries.map((entry) => row(entry));
}

export async function libraryShow(
  slug: string,
): Promise<LibraryRow & { notes: string; program: string; source: string }> {
  const entry = await findLibraryEntry(slug);
  return {
    ...row(entry),
    notes: entry.meta.notes,
    program: entry.program,
    source: await Bun.file(entry.program).text(),
  };
}

/**
 * Copies an entry's program to `<dir>/build.ts`. An untouched scaffold from
 * `build init` is replaced; an edited build.ts needs `force`.
 */
export async function libraryUse(
  slug: string,
  dir: string,
  options: { force: boolean },
): Promise<{ slug: string; program: string; replaced: boolean }> {
  const entry = await findLibraryEntry(slug);
  const target = new BuildWorkspace(dir).file(BUILD_FILES.program);
  const existing = Bun.file(target);
  const present = await existing.exists();
  if (present && !options.force && (await existing.text()) !== PROGRAM_TEMPLATE) {
    throw new Error(
      `${target} has edits; pass --force to replace it with library/${slug}`,
    );
  }
  await Bun.write(target, await Bun.file(entry.program).text());
  return { slug, program: target, replaced: present };
}
