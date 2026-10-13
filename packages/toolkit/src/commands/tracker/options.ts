import { parseArgs } from "node:util";
import { z } from "zod";

const string = { type: "string" } as const;
const boolean = { type: "boolean", default: false } as const;
const multiple = { type: "string", multiple: true } as const;
export function parseTrackerArgs(args: string[]) {
  return parseArgs({
    args,
    allowPositionals: true,
    options: {
      json: boolean,
      url: string,
      "actor-key": string,
      "actor-kind": string,
      "actor-name": string,
      team: string,
      state: multiple,
      label: multiple,
      project: string,
      priority: string,
      assignee: string,
      creator: string,
      "include-archived": boolean,
      "all-states": boolean,
      limit: string,
      cursor: string,
      sort: string,
      title: string,
      description: string,
      "description-file": string,
      "add-label": multiple,
      "remove-label": multiple,
      archive: boolean,
      unarchive: boolean,
      "expected-revision": string,
      body: string,
      "body-file": string,
      note: string,
      type: string,
      color: string,
      name: string,
      "input-json": string,
      mutation: boolean,
      remove: boolean,
    },
  });
}
export type TrackerOptions = ReturnType<typeof parseTrackerArgs>["values"];
export function required(value: string | undefined, label: string): string {
  if (value === undefined || value === "")
    throw new Error(`${label} is required`);
  return value;
}
export function integer(value: string | undefined): number | undefined {
  return value === undefined
    ? undefined
    : z.coerce.number().int().nonnegative().parse(value);
}
export async function textInput(
  value: string | undefined,
  file: string | undefined,
): Promise<string | undefined> {
  if (value !== undefined && file !== undefined)
    throw new Error("Use inline text or a file, not both");
  return file === undefined ? value : Bun.file(file).text();
}
