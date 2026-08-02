export const PREFERRED_POKEMONCTL_CAPABILITIES = [
  { promptCommand: "observe", handler: "observe" },
  { promptCommand: "tap", handler: "tap" },
  { promptCommand: "move", handler: "move" },
  { promptCommand: "interact", handler: "interact" },
  { promptCommand: "advance", handler: "advance" },
  { promptCommand: "wait", handler: "wait" },
  { promptCommand: "map show", handler: "map" },
  { promptCommand: "map exits", handler: "map" },
  { promptCommand: "navigate", handler: "navigate" },
  { promptCommand: "navigate --exit", handler: "navigate" },
  { promptCommand: "battle move", handler: "battle" },
  { promptCommand: "battle item", handler: "battle" },
  { promptCommand: "battle switch", handler: "battle" },
  { promptCommand: "battle run", handler: "battle" },
  { promptCommand: "battle target", handler: "battle" },
] as const;

export function verifyPokemonctlCapabilities(
  handlers: ReadonlySet<string>,
): void {
  for (const capability of PREFERRED_POKEMONCTL_CAPABILITIES) {
    if (!handlers.has(capability.handler)) {
      throw new Error(
        `Prompt advertises unsupported pokemonctl command: ${capability.promptCommand}`,
      );
    }
  }
}
