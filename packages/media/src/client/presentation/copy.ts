import type { StatusTone } from "#client/status/tone.ts";

/**
 * How one value of a contract enum reads to a household member: the words
 * and the tone of the badge that carries them.
 *
 * Every table in this directory is written `satisfies Record<Enum, …>`, so an
 * enum that gains a value stops compiling here until the value has copy. No
 * table has a default: an unknown value is a broken contract, not something
 * to paper over with its raw name.
 */
export type Copy = { label: string; tone: StatusTone };
