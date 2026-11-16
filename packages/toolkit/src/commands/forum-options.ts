import { parseArgs } from "node:util";
import { z } from "zod";

export const ForumActionSchema = z.enum([
  "list",
  "search",
  "inbox",
  "scopes",
  "view",
  "show",
  "post",
  "update",
  "reply",
  "edit-reply",
  "delete-reply",
  "resolve",
  "reopen",
  "pin",
  "unpin",
  "accept",
  "unaccept",
  "claim",
  "handoff",
  "vote",
  "unvote",
  "react",
  "unreact",
  "subscribe",
  "unsubscribe",
  "read",
  "link",
  "unlink",
  "promote",
]);
export type ForumAction = z.infer<typeof ForumActionSchema>;

const string = { type: "string" } as const;
const boolean = { type: "boolean", default: false } as const;
const multiple = { type: "string", multiple: true } as const;

export function parseForumArgs(args: string[]) {
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
      scope: multiple,
      "clear-scopes": boolean,
      condition: string,
      "condition-file": string,
      "expires-at": string,
      "expected-revision": string,
      note: string,
      "note-file": string,
      state: string,
      all: boolean,
      sort: string,
      project: string,
      owner: string,
      creator: string,
      issue: multiple,
      unread: boolean,
      subscribed: boolean,
      pinned: boolean,
      "parent-reply": string,
      reply: string,
      attach: multiple,
      emoji: string,
      to: string,
      team: string,
      priority: string,
      mute: boolean,
      once: boolean,
      "until-resolved": boolean,
      "timeout-sec": string,
      limit: string,
      cursor: string,
    },
  });
}
export type ForumOptions = ReturnType<typeof parseForumArgs>["values"];
