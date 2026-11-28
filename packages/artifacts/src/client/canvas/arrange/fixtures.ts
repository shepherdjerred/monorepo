import {
  EMPTY_BOARD_INDEX,
  type BoardIndex,
} from "@shepherdjerred/artifacts/contract";

/** Frame ids shared by the arrange tests. */
export const A = "11111111-1111-4111-8111-111111111111";
export const B = "22222222-2222-4222-8222-222222222222";
export const C = "33333333-3333-4333-8333-333333333333";

/** Two frames side by side: A at the origin, B 700 px to its right. */
export function board(): BoardIndex {
  return {
    ...EMPTY_BOARD_INDEX,
    frames: {
      [A]: { page: 0, x: 0, y: 0, w: 640, h: 420 },
      [B]: { page: 0, x: 700, y: 0, w: 640, h: 420 },
    },
    order: [A, B],
  };
}
