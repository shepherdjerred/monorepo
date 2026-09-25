import { useState, type JSX } from "react";
import { Box, Text, useApp, useInput } from "ink";
import { directBinary, fishWord, noFishCommand } from "#lib/brim/fish.ts";
import {
  budgetRemaining,
  columnWidths,
  formatAlignedStats,
  pressureColor,
  pressureForRemaining,
  usageBar,
  type ColumnWidths,
} from "#lib/brim/selection.ts";
import type { RankedEntry, RankResult } from "#lib/brim/rank.ts";

type RowDescriptor =
  | { readonly kind: "heading"; readonly key: string; readonly text: string }
  | {
      readonly kind: "option";
      readonly key: string;
      readonly entry: RankedEntry;
      readonly index: number;
    }
  | { readonly kind: "dim"; readonly key: string; readonly text: string };

function rowDescriptors(result: RankResult): RowDescriptor[] {
  const rows: RowDescriptor[] = [
    { kind: "heading", key: "heading-ranked", text: "Sorted by usage" },
  ];
  let index = 0;
  for (const entry of [...result.ranked, ...result.other]) {
    rows.push({ kind: "option", key: entry.provider, entry, index });
    index += 1;
  }
  if (result.other.length > 0) {
    rows.splice(1 + result.ranked.length, 0, {
      kind: "heading",
      key: "heading-other",
      text: "Other windows",
    });
  }
  rows.push({
    kind: "heading",
    key: "heading-unavailable",
    text: "Unavailable",
  });
  if (result.unavailable.length === 0) {
    rows.push({ kind: "dim", key: "unavailable-none", text: "  (none)" });
  }
  for (const entry of result.unavailable) {
    rows.push({
      kind: "dim",
      key: entry.provider,
      text: `  ${entry.displayName} — ${entry.reason ?? "no data"}`,
    });
  }
  return rows;
}

function OptionRow({
  entry,
  selected,
  widths,
}: {
  readonly entry: RankedEntry;
  readonly selected: boolean;
  readonly widths: ColumnWidths;
}): JSX.Element {
  const used = entry.budgetUsed ?? entry.fallbackWindow?.[1] ?? null;
  const bar = used === null ? null : usageBar(used, 8);
  const barColor = pressureColor(pressureForRemaining(budgetRemaining(entry)));
  return (
    <Text>
      <Text {...(selected ? { color: "green" } : {})} bold={selected}>
        {selected ? "> " : "  "}
      </Text>
      <Text bold={selected}>{entry.displayName.padEnd(widths.name)} </Text>
      {bar === null ? null : <Text color={barColor}>{bar} </Text>}
      <Text dimColor={!selected}>{formatAlignedStats(entry, widths)}</Text>
    </Text>
  );
}

function PickerRow({
  row,
  selected,
  widths,
}: {
  readonly row: RowDescriptor;
  readonly selected: boolean;
  readonly widths: ColumnWidths;
}): JSX.Element {
  switch (row.kind) {
    case "heading":
      return (
        <Text bold key={row.key}>
          {row.text}
        </Text>
      );
    case "option":
      return (
        <OptionRow
          key={row.key}
          entry={row.entry}
          selected={selected}
          widths={widths}
        />
      );
    case "dim":
      return (
        <Text dimColor key={row.key}>
          {row.text}
        </Text>
      );
  }
}

function SpawnPreview({
  entry,
  programs,
  noFish,
}: {
  readonly entry: RankedEntry;
  readonly programs: ReadonlyMap<string, string>;
  readonly noFish: boolean;
}): JSX.Element {
  const name =
    entry.accountLabel === null
      ? entry.displayName
      : `${entry.displayName} (${entry.accountLabel})`;
  // Under --no-fish the spawn bypasses fish entirely, so preview the
  // configured fallback command instead of fish resolution.
  if (noFish) {
    const fallback = noFishCommand(entry.provider);
    if (fallback !== null) {
      return (
        <Text>
          <Text dimColor>{name} · will spawn </Text>
          <Text color="cyan">{`${fallback.argv.join(" ")} (no-fish)`}</Text>
        </Text>
      );
    }
  }
  // Resolved `fish -i -c` program (abbreviations spliced as their
  // expansion, since bare words never expand inside `-c`).
  const program = programs.get(entry.provider);
  if (program !== undefined) {
    return (
      <Text>
        <Text dimColor>{name} · will spawn </Text>
        <Text color="cyan">{`fish -i -c '${program}'`}</Text>
      </Text>
    );
  }
  const binary = directBinary(entry.provider);
  if (binary !== null) {
    const installed = Bun.which(binary) !== null;
    return (
      <Text>
        <Text dimColor>{name} · will spawn </Text>
        <Text color={installed ? "yellow" : "red"}>
          {installed
            ? `${binary} (direct)`
            : `${binary} (direct, not installed)`}
        </Text>
      </Text>
    );
  }
  const word = fishWord(entry.provider);
  return (
    <Text>
      <Text color="red">no fish command for {name}</Text>
      <Text dimColor>
        {word === null
          ? " · add an abbreviation to spawn it"
          : ` · fish defines nothing for "${word}"`}
      </Text>
    </Text>
  );
}

export function ProviderPicker({
  result,
  programs,
  noFish,
  onSubmit,
}: {
  readonly result: RankResult;
  readonly programs: ReadonlyMap<string, string>;
  readonly noFish: boolean;
  readonly onSubmit: (entry: RankedEntry | null) => void;
}): JSX.Element {
  const { exit } = useApp();
  const [cursor, setCursor] = useState(0);
  const selectable: readonly RankedEntry[] = [
    ...result.ranked,
    ...result.other,
  ];

  useInput((_, key) => {
    if (key.upArrow || key.downArrow) {
      const delta = key.upArrow ? -1 : 1;
      setCursor(
        (current) => (current + delta + selectable.length) % selectable.length,
      );
    } else if (key.return) {
      const chosen = selectable[cursor];
      onSubmit(chosen ?? null);
      exit();
    } else if (key.escape) {
      onSubmit(null);
      exit();
    }
  });

  const active = selectable[cursor];
  const widths = columnWidths(selectable);
  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor="gray"
      paddingX={1}
    >
      <Text>
        <Text bold>brim</Text>
        <Text dimColor> · least-used session first</Text>
      </Text>
      {rowDescriptors(result).map((row) => (
        <PickerRow
          key={row.key}
          row={row}
          selected={row.kind === "option" && row.index === cursor}
          widths={widths}
        />
      ))}
      {active === undefined ? null : (
        <SpawnPreview entry={active} programs={programs} noFish={noFish} />
      )}
      <Text dimColor>↑↓ to move · Enter to spawn · Esc to cancel</Text>
    </Box>
  );
}
