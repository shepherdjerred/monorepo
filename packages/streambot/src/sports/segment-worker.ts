import { z } from "zod";
import { unwrapSportsSegment } from "./segment-payload.ts";

declare const self: Worker;
const RequestSchema = z.object({
  id: z.number().int().nonnegative(),
  bytes: z.instanceof(Uint8Array),
});
self.addEventListener("message", (event: MessageEvent<unknown>) => {
  const request = RequestSchema.parse(event.data);
  try {
    const bytes = new Uint8Array(unwrapSportsSegment(request.bytes));
    self.postMessage({ id: request.id, ok: true, bytes }, [bytes.buffer]);
  } catch {
    self.postMessage({ id: request.id, ok: false });
  }
});
