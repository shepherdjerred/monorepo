// Types for agents.js, for the dotfiles test suite's typecheck.

export type Mode = {
  id: string;
  label: string;
  args: string[];
  safe?: boolean;
};

export type Capabilities = {
  modes: Mode[];
  efforts: string[];
  model: ((model: string) => string[]) | null;
  effort: ((effort: string) => string[]) | null;
};

export type CatalogModel = { id: string; label: string; efforts?: string[] };

export const AGENTS: Record<string, Capabilities>;
export function capabilities(provider: string): Capabilities;
export function agentArgs(
  provider: string,
  choice: { mode: string | null; model: string | null; effort: string | null },
): { args: string[]; safe: boolean };
export function parseCodexModels(text: string): CatalogModel[];
export function parseAgyModels(text: string): CatalogModel[];
export function parseGrokModels(text: string): CatalogModel[];
export function parseKimiModels(text: string): CatalogModel[];
export const CLAUDE_MODELS: CatalogModel[];
