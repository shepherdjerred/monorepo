import { z } from "zod";

/**
 * Link state for a navigation between views of one page, such as the
 * segments of the Library. The shell moves focus to the heading after every
 * other navigation (`shell/route-focus.ts`); after one that carries this
 * state it leaves focus on the control the reader used.
 */
export const SAME_PAGE = { samePage: true } as const;

const SamePageSchema = z.object({ samePage: z.literal(true) });

/** Whether a location's state, which can be anything, is `SAME_PAGE`. */
export function staysOnPage(state: unknown): boolean {
  return SamePageSchema.safeParse(state).success;
}
