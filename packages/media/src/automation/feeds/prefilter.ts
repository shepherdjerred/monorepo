import type { ProviderCandidate } from "#integrations/providers.ts";
import { normalizeMediaTitle } from "#domain/release-parser.ts";
import { canonicalReferences } from "#infrastructure/acquisition-identity/references.ts";
import type { FeedMatchTarget } from "./selection.ts";

/** Advisory only: every possible hit still passes the actual identity, cut and quality assessment. */
export function feedTargetMayMatch(
  target: FeedMatchTarget,
  source: ProviderCandidate,
) {
  if ((source.references?.length ?? 0) > 0) return true;
  const media = target.media;
  const root =
    media.kind === "movie"
      ? media
      : media.parent?.kind === "series"
        ? media.parent
        : media.parent?.kind === "season" &&
            media.parent.parent?.kind === "series"
          ? media.parent.parent
          : null;
  if (root === null)
    throw new Error("Monitored feed target lost its canonical movie or series");
  const catalog = canonicalReferences(root);
  const text = ` ${normalizeMediaTitle(source.title)} `;
  return [root.title, ...catalog.aliases].some((title) => {
    const name = normalizeMediaTitle(title);
    return name.length > 0 && text.includes(` ${name} `);
  });
}
