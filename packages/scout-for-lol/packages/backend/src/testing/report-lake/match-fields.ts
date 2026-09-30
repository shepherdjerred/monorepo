/** A fixture's inventory as the seven slot columns; missing slots are empty. */
export function itemSlots(items: readonly number[] = []) {
  const at = (slot: number) => items[slot] ?? 0;
  return {
    item0: at(0),
    item1: at(1),
    item2: at(2),
    item3: at(3),
    item4: at(4),
    item5: at(5),
    item6: at(6),
  };
}

export function augmentFields(
  augmentIds: readonly (number | null)[] | undefined,
) {
  return {
    augment_1_id: augmentIds?.[0] ?? null,
    augment_2_id: augmentIds?.[1] ?? null,
    augment_3_id: augmentIds?.[2] ?? null,
    augment_4_id: augmentIds?.[3] ?? null,
    augment_5_id: augmentIds?.[4] ?? null,
    augment_6_id: augmentIds?.[5] ?? null,
  };
}
