import { existsSync } from "fs";
import { resolve } from "path";
import { logger } from "./logger.js";

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
    logger.error(addErrorLinks(`The ${pathName} do not exist at expected path, which is ${path}`));
    throw Error(`${path} does not exist`);
  }
}
