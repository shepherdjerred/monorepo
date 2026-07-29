// Generates the committed move and item catalogs from the exact
// pokeemerald-wasm source pin used to build the emulator.
//
//   bun scripts/generate-battle-data.ts

import { readOttohgSha } from "./lib/pokeemerald-pin.ts";

type Catalog = {
  names: string[];
  idsByNormalizedName: Record<string, number>;
};

type RenderCatalogOptions = {
  sourceRef: string;
  generatorPath: string;
  countExport: string;
  namesExport: string;
  lookupName: string;
  displayNameFunction: string;
  resolverFunction: string;
  names: string[];
  idsByNormalizedName: Record<string, number>;
};

function addUniqueName(
  names: Map<string, string>,
  symbol: string,
  displayName: string,
): void {
  const previous = names.get(symbol);
  if (previous !== undefined) {
    throw new Error(
      `duplicate name for ${symbol}: ${JSON.stringify(previous)} and ${JSON.stringify(displayName)}`,
    );
  }
  names.set(symbol, displayName);
}

export function parseContiguousIds(
  source: string,
  prefix: string,
  countSymbol: string,
): Map<string, number> {
  const definitions: { symbol: string; id: number }[] = [];
  let count: number | undefined;
  const definePattern = /^#define\s+([A-Z0-9_]+)\s+(\d+)\s*$/gm;
  for (const match of source.matchAll(definePattern)) {
    const symbol = match[1];
    const idText = match[2];
    if (symbol === undefined || idText === undefined) {
      throw new Error("invalid numeric definition");
    }
    if (symbol === countSymbol) {
      count = Number(idText);
      break;
    }
    if (symbol.startsWith(prefix)) {
      definitions.push({ symbol, id: Number(idText) });
    }
  }

  if (count === undefined) {
    throw new Error(`${countSymbol} not found`);
  }

  const ids = new Map<string, number>();
  const symbolsById = new Map<number, string>();

  for (const { symbol, id } of definitions) {
    if (ids.has(symbol)) {
      throw new Error(`duplicate ID definition for ${symbol}`);
    }

    if (id < 0 || id >= count) {
      throw new Error(
        `${symbol} has ID ${String(id)} outside 0..${String(count - 1)}`,
      );
    }
    const previousSymbol = symbolsById.get(id);
    if (previousSymbol !== undefined) {
      throw new Error(
        `ID ${String(id)} is assigned to both ${previousSymbol} and ${symbol}`,
      );
    }
    ids.set(symbol, id);
    symbolsById.set(id, symbol);
  }

  for (let id = 0; id < count; id += 1) {
    if (!symbolsById.has(id)) {
      throw new Error(`${prefix} catalog is missing ID ${String(id)}`);
    }
  }
  if (ids.size !== count) {
    throw new Error(
      `${prefix} catalog has ${String(ids.size)} definitions, expected ${String(count)}`,
    );
  }
  return ids;
}

export function parseMoveNames(source: string): Map<string, string> {
  const names = new Map<string, string>();
  const pattern = /\[(MOVE_\w+)\]\s*=\s*_\("([^"]*)"\)/g;
  for (const match of source.matchAll(pattern)) {
    const symbol = match[1];
    const displayName = match[2];
    if (symbol === undefined || displayName === undefined) {
      throw new Error("invalid move name definition");
    }
    addUniqueName(names, symbol, displayName);
  }
  return names;
}

export function parseItemNames(
  source: string,
  ids: Map<string, number>,
): Map<string, string> {
  const names = new Map<string, string>();
  const entries = [...source.matchAll(/^\s*\[ITEM_\w+\]\s*=\s*$/gm)];
  for (const [index, match] of entries.entries()) {
    const trimmedDesignator = match[0].trim();
    const closingBracket = trimmedDesignator.indexOf("]");
    if (closingBracket === -1) {
      throw new Error(`invalid item designator ${trimmedDesignator}`);
    }
    const designatedSymbol = trimmedDesignator.slice(1, closingBracket);
    const nextEntry = entries[index + 1];
    const body = source.slice(match.index, nextEntry?.index);
    const displayName = /\.name\s*=\s*_\("([^"]*)"\)/.exec(body)?.[1];
    if (displayName === undefined) {
      throw new Error(`item name missing for ${designatedSymbol}`);
    }
    const itemIdSymbol = /\.itemId\s*=\s*(ITEM_\w+)/.exec(body)?.[1];
    const symbol = ids.has(designatedSymbol) ? designatedSymbol : itemIdSymbol;
    if (symbol === undefined || !ids.has(symbol)) {
      throw new Error(
        `item name ${designatedSymbol} does not resolve to a numeric item ID`,
      );
    }
    addUniqueName(names, symbol, displayName);
  }
  return names;
}

export function normalizeCatalogName(value: string): string {
  return value
    .normalize("NFKD")
    .replaceAll(/\p{M}/gu, "")
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, " ")
    .trim()
    .replaceAll(/\s+/g, " ");
}

export function buildCatalog(
  ids: Map<string, number>,
  displayNames: Map<string, string>,
): Catalog {
  if (ids.size !== displayNames.size) {
    throw new Error(
      `catalog has ${String(ids.size)} IDs but ${String(displayNames.size)} names`,
    );
  }

  const namesById = new Map<number, string>();
  const idsByNormalizedName: Record<string, number> = {};
  for (const [symbol, id] of ids) {
    const displayName = displayNames.get(symbol);
    if (displayName === undefined) {
      throw new Error(`catalog name missing for ${symbol}`);
    }
    namesById.set(id, displayName);

    // "-" and "????????" are upstream placeholders, not user-addressable
    // catalog names.
    const normalizedName = normalizeCatalogName(displayName);
    if (normalizedName.length === 0) continue;
    const previousId = idsByNormalizedName[normalizedName];
    if (previousId !== undefined && previousId !== id) {
      throw new Error(
        `normalized name ${JSON.stringify(normalizedName)} maps to IDs ${String(previousId)} and ${String(id)}`,
      );
    }
    idsByNormalizedName[normalizedName] = id;
  }

  for (const symbol of displayNames.keys()) {
    if (!ids.has(symbol)) {
      throw new Error(`catalog ID missing for ${symbol}`);
    }
  }
  const names = Array.from({ length: ids.size }, (_, id) => {
    const name = namesById.get(id);
    if (name === undefined) {
      throw new Error(`catalog contains no name for ID ${String(id)}`);
    }
    return name;
  });
  return { names, idsByNormalizedName };
}

export function renderCatalogModule(options: RenderCatalogOptions): string {
  return `// AUTO-GENERATED by ${options.generatorPath} — do not edit by hand.
// Source: ottohg/pokeemerald-wasm@${options.sourceRef}

export const ${options.countExport} = ${String(options.names.length)};

export const ${options.namesExport}: readonly string[] = ${JSON.stringify(options.names)};

const ${options.lookupName}: Readonly<Record<string, number>> = ${JSON.stringify(options.idsByNormalizedName)};

function normalizeCatalogName(value: string): string {
  return value
    .normalize("NFKD")
    .replaceAll(/\\p{M}/gu, "")
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, " ")
    .trim()
    .replaceAll(/\\s+/g, " ");
}

export function ${options.displayNameFunction}(id: number): string {
  return ${options.namesExport}[id] ?? \`#\${String(id)}\`;
}

export function ${options.resolverFunction}(name: string): number | undefined {
  return ${options.lookupName}[normalizeCatalogName(name)];
}
`;
}

async function fetchText(rawRoot: string, path: string): Promise<string> {
  const response = await fetch(`${rawRoot}/${path}`);
  if (!response.ok) {
    throw new Error(`failed to fetch ${path}: ${String(response.status)}`);
  }
  return response.text();
}

async function formatGeneratedFiles(paths: string[]): Promise<void> {
  const process = Bun.spawn(["bunx", "prettier", "--write", ...paths], {
    stdout: "inherit",
    stderr: "inherit",
  });
  const exitCode = await process.exited;
  if (exitCode !== 0) {
    throw new Error(`prettier exited with code ${String(exitCode)}`);
  }
}

export async function generateBattleData(): Promise<void> {
  const sourceRef = await readOttohgSha();
  const rawRoot = `https://raw.githubusercontent.com/ottohg/pokeemerald-wasm/${sourceRef}`;
  const [moveIdsSource, moveNamesSource, itemIdsSource, itemNamesSource] =
    await Promise.all([
      fetchText(rawRoot, "include/constants/moves.h"),
      fetchText(rawRoot, "src/data/text/move_names.h"),
      fetchText(rawRoot, "include/constants/items.h"),
      fetchText(rawRoot, "src/data/items.h"),
    ]);

  const moves = buildCatalog(
    parseContiguousIds(moveIdsSource, "MOVE_", "MOVES_COUNT"),
    parseMoveNames(moveNamesSource),
  );
  const itemIds = parseContiguousIds(itemIdsSource, "ITEM_", "ITEMS_COUNT");
  const items = buildCatalog(itemIds, parseItemNames(itemNamesSource, itemIds));

  const moveOutput = new URL(
    "../packages/backend/src/game/battle/generated/move-names.ts",
    import.meta.url,
  ).pathname;
  const itemOutput = new URL(
    "../packages/backend/src/game/battle/generated/item-names.ts",
    import.meta.url,
  ).pathname;

  await Promise.all([
    Bun.write(
      moveOutput,
      renderCatalogModule({
        sourceRef,
        generatorPath: "scripts/generate-battle-data.ts",
        countExport: "MOVES_COUNT",
        namesExport: "MOVE_NAMES",
        lookupName: "MOVE_IDS_BY_NORMALIZED_NAME",
        displayNameFunction: "moveName",
        resolverFunction: "resolveMoveId",
        names: moves.names,
        idsByNormalizedName: moves.idsByNormalizedName,
      }),
    ),
    Bun.write(
      itemOutput,
      renderCatalogModule({
        sourceRef,
        generatorPath: "scripts/generate-battle-data.ts",
        countExport: "ITEMS_COUNT",
        namesExport: "ITEM_NAMES",
        lookupName: "ITEM_IDS_BY_NORMALIZED_NAME",
        displayNameFunction: "itemName",
        resolverFunction: "resolveItemId",
        names: items.names,
        idsByNormalizedName: items.idsByNormalizedName,
      }),
    ),
  ]);
  await formatGeneratedFiles([moveOutput, itemOutput]);
  console.log(
    `wrote ${moveOutput} (${String(moves.names.length)} moves) and ${itemOutput} (${String(items.names.length)} items)`,
  );
}

if (import.meta.main) {
  await generateBattleData();
}
