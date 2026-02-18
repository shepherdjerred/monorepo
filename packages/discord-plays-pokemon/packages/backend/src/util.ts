import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { logger } from "./logger.ts";

export function wait(milliseconds: number): Promise<void> {
  return new Promise(function (resolve) {
    setTimeout(resolve, milliseconds);
  });
}

export function addErrorLinks(s: string) {
  return `${s}\n\nFor more information, read the setup guide (https://docs.discord-plays-pokemon.com/user/)\nIf you are unable to resolve this error, please open an issue (https://github.com/shepherdjerred/discord-plays-pokemon/issues)\n`;
}

export function assertPathExists(s: string, pathName: string) {
  const path = resolve(s);

  if (!existsSync(path)) {
    logger.error(
      addErrorLinks(
        `The ${pathName} do not exist at expected path, which is ${path}`,
      ),
    );
    throw new Error(`${path} does not exist`);
  }
}
