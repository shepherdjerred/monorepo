import {
  CommandPalette,
  CommandPaletteSearch,
  createCommandPaletteStore,
  type CommandPaletteItem,
  type CommandPaletteSection,
} from "@shepherdjerred/console-ui";
import type { FlagValue } from "@shepherdjerred/feature-flags/evaluate.ts";
import { FlagIcon } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router";
import { useDeployments } from "./api.ts";
import { deploymentIcon, VIEWS } from "./nav.ts";
import { deploymentPath, flagPath, splitDeploymentId } from "./model.ts";
import { useDocuments } from "./views/views-api.ts";

export const PALETTE_LABEL = "Search deployments and flags";

/** Whether the palette is open; creating it binds ⌘K and Ctrl+K. */
export const paletteStore = createCommandPaletteStore();

export type PaletteItem = CommandPaletteItem & { readonly href: string };

/** At most this many flag matches; a broad query should be narrowed. */
const FLAG_LIMIT = 50;

function matches(text: string, needle: string): boolean {
  return needle.length === 0 || text.toLowerCase().includes(needle);
}

/**
 * The palette's results for `query`: views and deployments always, flags
 * across every loaded deployment once something is typed.
 */
export function paletteSections(
  query: string,
  ids: readonly string[],
  documents: readonly {
    readonly id: string;
    readonly flags: readonly FlagValue[];
  }[],
): CommandPaletteSection<PaletteItem>[] {
  const needle = query.trim().toLowerCase();
  const views = VIEWS.filter((view) => matches(view.label, needle)).map(
    (view): PaletteItem => ({
      id: `view:${view.href}`,
      label: view.label,
      icon: view.icon,
      href: view.href,
    }),
  );
  const deployments = ids
    .filter((id) => matches(id, needle))
    .map((id): PaletteItem => {
      const { catalog, stage } = splitDeploymentId(id);
      return {
        id: `deployment:${id}`,
        label: id,
        icon: deploymentIcon(stage),
        href: deploymentPath(catalog, stage),
      };
    });
  const flags =
    needle.length === 0
      ? []
      : documents
          .flatMap((document) => {
            const { catalog, stage } = splitDeploymentId(document.id);
            return document.flags
              .filter((flag) => matches(flag.key, needle))
              .map((flag): PaletteItem => ({
                id: `flag:${document.id}:${flag.key}`,
                label: flag.key,
                detail: document.id,
                icon: FlagIcon,
                href: flagPath(catalog, stage, flag.key),
              }));
          })
          .slice(0, FLAG_LIMIT);
  return [
    { heading: "Views", items: views },
    { heading: "Deployments", items: deployments },
    { heading: "Flags", items: flags },
  ].filter((section) => section.items.length > 0);
}

function PaletteBody(): React.JSX.Element {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const deployments = useDeployments();
  const ids = deployments.data?.map((deployment) => deployment.id) ?? [];
  // The body mounts with each opening, so documents load only once the
  // palette is first used; later openings read them from the cache.
  const documents = useDocuments(ids);
  const loaded = documents.flatMap((result) =>
    result.data === undefined ? [] : [result.data],
  );
  const loading =
    deployments.isPending || documents.some((result) => result.isPending);
  const failed =
    deployments.isError || documents.some((result) => result.isError);
  const typed = query.trim().length > 0;
  return (
    <CommandPaletteSearch
      store={paletteStore}
      label={PALETTE_LABEL}
      placeholder="Search deployments and flags…"
      query={query}
      onQueryChange={setQuery}
      sections={paletteSections(query, ids, loaded)}
      status={
        typed && loading
          ? "Loading flags…"
          : typed && failed
            ? "Some deployments could not be searched."
            : undefined
      }
      onSelect={(item) => {
        void navigate(item.href);
      }}
    />
  );
}

/** The ⌘K palette; it searches every deployment's flags. */
export function FlagsPalette(): React.JSX.Element {
  return (
    <CommandPalette store={paletteStore} label={PALETTE_LABEL}>
      <PaletteBody />
    </CommandPalette>
  );
}
