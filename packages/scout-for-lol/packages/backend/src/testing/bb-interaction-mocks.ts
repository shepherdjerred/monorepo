import { vi } from "vitest";

/**
 * The acknowledgement methods every `/bb` subcommand mock interaction needs
 * to satisfy `BbCommandInteraction`'s structural shape.
 *
 * Extracted because each `/bb` subcommand's test file otherwise hand-rolls
 * the same `reply`/`deferReply`/`editReply` mocks — one definition keeps a
 * future acknowledgement-contract change from drifting between them. Each
 * caller still supplies its own `followUp` mock, since that behavior
 * (a plain resolve, a conditional rejection, …) is the one part that
 * legitimately varies per command.
 *
 * Deliberately has no hand-written return type: `vi.fn(() => ...)` infers a
 * mock whose call signature matches the passed function, which is exactly
 * what `BbCommandInteraction`'s methods need — annotating this any more
 * broadly (e.g. `ReturnType<typeof vi.fn>`) widens that back to a signature
 * Discord.js's real method types reject.
 */
export function bbInteractionAckMocks(deferred: boolean) {
  return {
    replied: false,
    deferred,
    reply: vi.fn(() => Promise.resolve(undefined)),
    deferReply: vi.fn(() => Promise.resolve(undefined)),
    editReply: vi.fn(() => Promise.resolve(undefined)),
  };
}
