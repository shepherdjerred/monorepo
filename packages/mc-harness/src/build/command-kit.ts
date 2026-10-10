/** What every `build` sub-command module shares: the handler shape and the json/human printer. */
import type { Env } from "./helpers.ts";

export type Handler<Values> = (
  env: Env,
  dir: string,
  values: Values,
  rest: string[],
) => Promise<number>;

export function print(json: boolean, value: unknown, human: string): void {
  process.stdout.write(`${json ? JSON.stringify(value, null, 2) : human}\n`);
}
