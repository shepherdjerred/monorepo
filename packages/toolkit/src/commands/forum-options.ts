import { parseArgs } from "node:util";

export function parseForumArgs(args: string[]) {
  const string = { type: "string" } as const;
  const boolean = { type: "boolean", default: false } as const;
  return parseArgs({
    args,
    allowPositionals: true,
    options: {
      json: boolean,
      url: string,
      "actor-key": string,
      "actor-kind": string,
      "actor-name": string,
      kind: string,
      title: string,
      body: string,
      "body-file": string,
      scope: { type: "string", multiple: true },
      "clear-scopes": boolean,
      condition: string,
      "condition-file": string,
      "expires-at": string,
      "expected-revision": string,
      note: string,
      "note-file": string,
      state: string,
      all: boolean,
      limit: string,
      cursor: string,
    },
  });
}
export type ForumOptions = ReturnType<typeof parseForumArgs>["values"];
