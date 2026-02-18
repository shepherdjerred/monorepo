import path from "node:path";
import { logger } from "./logger.ts";

export function wait(milliseconds: number): Promise<void> {
  return new Promise(function (waitResolve) {
    setTimeout(waitResolve, milliseconds);
  });
}

export function addErrorLinks(s: string) {
  return `${s}\n\nFor more information, read the setup guide (https://docs.discord-plays-pokemon.com/user/)\nIf you are unable to resolve this error, please open an issue (https://github.com/shepherdjerred/discord-plays-pokemon/issues)\n`;
}

export function assertPathExists(s: string, pathName: string) {
  const resolved = path.resolve(s);

  if (Bun.file(resolved).size === 0) {
    logger.error(
      addErrorLinks(
        `The ${pathName} do not exist at expected path, which is ${resolved}`,
      ),
    );
    throw new Error(`${resolved} does not exist`);
  }
}
