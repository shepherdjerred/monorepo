import { router, publicProcedure } from "@shepherdjerred/sentinel/trpc/trpc.ts";
import { getQueueStats } from "@shepherdjerred/sentinel/queue/index.ts";

export const statsRouter = router({
  queue: publicProcedure.query(() => getQueueStats()),
});
