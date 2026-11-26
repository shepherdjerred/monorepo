import { initTRPC } from "@trpc/server";

/** Which listener served the request; `maintenance.*` is internal only. */
export type HostClass = "app" | "internal";

export type RouterContext = {
  requestId: string;
  hostClass: HostClass;
};

export const t = initTRPC.context<RouterContext>().create();
export const procedure = t.procedure;
