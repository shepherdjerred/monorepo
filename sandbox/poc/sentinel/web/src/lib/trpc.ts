import { createTRPCReact } from "@trpc/react-query";
import type { AppRouter } from "../../../src/trpc/router/index.ts";

export const trpc = createTRPCReact<AppRouter>();
