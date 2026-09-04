import {
  BucksDareV2StateSchema,
  DareTargetBindingV2Schema,
  type BucksDareV2State,
  type DiscordAccountId,
} from "@scout-for-lol/data";

export type VisibleDareIndexRow = {
  id: number;
  dareState: string;
  currentRevision: number;
  fundedRevision: number | null;
  challengerDiscordId: string;
  acceptDeadline: Date | null;
  deadlineAt: Date | null;
  updatedAt: Date;
  revisions: {
    revision: number;
    originalText: string;
    targetsJson: string;
  }[];
  targets: {
    discordId: string;
    alias: string;
    acceptedAt: Date | null;
    declinedAt: Date | null;
  }[];
  contributions: { discordId: string }[];
};

export type VisibleDareIndexItem = {
  id: number;
  state: BucksDareV2State;
  targetAliases: string[];
  viewerRoles: ("member" | "challenger" | "target" | "contributor")[];
  requiresViewerAction: boolean;
  acceptDeadline: string | null;
  deadlineAt: string | null;
  updatedAt: string;
};

export const visibleDareIndexSelectionV2 = {
  id: true,
  dareState: true,
  currentRevision: true,
  fundedRevision: true,
  challengerDiscordId: true,
  acceptDeadline: true,
  deadlineAt: true,
  updatedAt: true,
  revisions: {
    select: {
      revision: true,
      originalText: true,
      targetsJson: true,
    },
  },
  targets: {
    select: {
      discordId: true,
      alias: true,
      acceptedAt: true,
      declinedAt: true,
    },
  },
  contributions: { select: { discordId: true } },
};

export function dareViewerFactsV2(
  row: Pick<
    VisibleDareIndexRow,
    "dareState" | "challengerDiscordId" | "targets" | "contributions"
  >,
  viewerDiscordId: DiscordAccountId,
) {
  const state = BucksDareV2StateSchema.parse(row.dareState);
  const challenger = row.challengerDiscordId === viewerDiscordId;
  const target = row.targets.find(
    (candidate) => candidate.discordId === viewerDiscordId,
  );
  const contributor = row.contributions.some(
    (candidate) => candidate.discordId === viewerDiscordId,
  );
  const roles = [
    "member" as const,
    ...(challenger ? (["challenger"] as const) : []),
    ...(target === undefined ? [] : (["target"] as const)),
    ...(contributor ? (["contributor"] as const) : []),
  ];
  const awaitingTarget =
    state === "pending_accept" &&
    target?.acceptedAt === null &&
    target.declinedAt === null;
  const actions = [
    ...(state === "draft" && challenger
      ? (["fund", "delete_draft"] as const)
      : []),
    ...(awaitingTarget ? (["accept", "decline"] as const) : []),
    ...(state === "pending_accept" && challenger ? (["cancel"] as const) : []),
    ...(target === undefined &&
    (state === "pending_accept" || state === "activating" || state === "active")
      ? (["contribute"] as const)
      : []),
  ];
  return {
    roles,
    actions,
    requiresViewerAction: (state === "draft" && challenger) || awaitingTarget,
  };
}

function indexRevision(row: VisibleDareIndexRow) {
  const revisionNumber = row.fundedRevision ?? row.currentRevision;
  const revision = row.revisions.find(
    (candidate) => candidate.revision === revisionNumber,
  );
  if (revision === undefined) {
    throw new Error(
      `Dare v2 ${row.id.toString()} is missing revision ${revisionNumber.toString()}.`,
    );
  }
  return revision;
}

function indexedVisibleDare(
  row: VisibleDareIndexRow,
  viewerDiscordId: DiscordAccountId,
): VisibleDareIndexItem {
  const revision = indexRevision(row);
  const draftTargets = DareTargetBindingV2Schema.array().parse(
    JSON.parse(revision.targetsJson),
  );
  const viewer = dareViewerFactsV2(row, viewerDiscordId);
  return {
    id: row.id,
    state: BucksDareV2StateSchema.parse(row.dareState),
    targetAliases:
      row.targets.length === 0
        ? draftTargets.map((target) => target.alias)
        : row.targets.map((target) => target.alias),
    viewerRoles: viewer.roles,
    requiresViewerAction: viewer.requiresViewerAction,
    acceptDeadline: row.acceptDeadline?.toISOString() ?? null,
    deadlineAt: row.deadlineAt?.toISOString() ?? null,
    updatedAt: row.updatedAt.toISOString(),
  };
}

function matchesSearch(
  row: VisibleDareIndexRow,
  item: VisibleDareIndexItem,
  search: string | undefined,
): boolean {
  if (search === undefined || search.length === 0) return true;
  const normalizedSearch = search.toLocaleLowerCase();
  return (
    indexRevision(row)
      .originalText.toLocaleLowerCase()
      .includes(normalizedSearch) ||
    item.targetAliases.some((alias) =>
      alias.toLocaleLowerCase().includes(normalizedSearch),
    )
  );
}

function hasViewerRole(
  item: VisibleDareIndexItem,
  role: "challenger" | "target" | "contributor" | "involved" | undefined,
): boolean {
  if (role === undefined) return true;
  if (role === "involved") {
    return item.viewerRoles.some((candidate) => candidate !== "member");
  }
  return item.viewerRoles.includes(role);
}

function sortVisibleDares(
  items: VisibleDareIndexItem[],
  sort: "needs_action" | "deadline" | "updated",
): VisibleDareIndexItem[] {
  return items.toSorted((left, right) => {
    if (sort === "needs_action") {
      const action =
        Number(right.requiresViewerAction) - Number(left.requiresViewerAction);
      if (action !== 0) return action;
    }
    if (sort === "deadline") {
      const leftDeadline = left.deadlineAt ?? left.acceptDeadline;
      const rightDeadline = right.deadlineAt ?? right.acceptDeadline;
      if (leftDeadline !== rightDeadline) {
        if (leftDeadline === null) return 1;
        if (rightDeadline === null) return -1;
        return leftDeadline.localeCompare(rightDeadline);
      }
    }
    const updated = right.updatedAt.localeCompare(left.updatedAt);
    return updated === 0 ? right.id - left.id : updated;
  });
}

export function indexVisibleDaresV2(input: {
  rows: VisibleDareIndexRow[];
  viewerDiscordId: DiscordAccountId;
  search?: string | undefined;
  states?: BucksDareV2State[] | undefined;
  role?: "challenger" | "target" | "contributor" | "involved" | undefined;
  needsAction: boolean;
  sort: "needs_action" | "deadline" | "updated";
}): VisibleDareIndexItem[] {
  return sortVisibleDares(
    input.rows
      .map((row) => ({
        row,
        item: indexedVisibleDare(row, input.viewerDiscordId),
      }))
      .filter(
        ({ row, item }) =>
          matchesSearch(row, item, input.search) &&
          (input.states === undefined || input.states.includes(item.state)) &&
          hasViewerRole(item, input.role) &&
          (!input.needsAction || item.requiresViewerAction),
      )
      .map(({ item }) => item),
    input.sort,
  );
}
