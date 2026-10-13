// Ported from libraryaddict's Red Warfare
// (redwarfare-arcade/src/me/libraryaddict/arcade/kits/Kit.java, getKitLayout and giveItems, and
// KitLayoutInventory.java); see packages/the-storm/NOTICE.
package com.shepherdjerred.thestorm.rwf.domain.kit;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.TreeMap;

/**
 * Where a player keeps one kit's items: each item's position in {@link KitSpec#items()} (the fuse
 * being 0) mapped to the inventory slot they want it in. Red Warfare saved one per kit and fell
 * back to the kit's own layout whenever a saved one no longer listed exactly the kit's items, so a
 * kit that gains or loses an item never strands a player with a broken inventory.
 *
 * @param slots item position to inventory slot
 */
public record KitLayout(Map<Integer, Integer> slots) {

  /** The inventory slots a layout may use: the hotbar and the main inventory. */
  public static final int INVENTORY_SLOTS = 36;

  public KitLayout {
    slots = Map.copyOf(new TreeMap<>(slots));
    if (new HashSet<>(slots.values()).size() != slots.size()) {
      throw new IllegalArgumentException("two items share a slot: " + slots);
    }
    for (var entry : slots.entrySet()) {
      if (entry.getKey() < 0 || entry.getValue() < 0 || entry.getValue() >= INVENTORY_SLOTS) {
        throw new IllegalArgumentException("a layout slot must be 0-35: " + entry);
      }
    }
  }

  /** {@code kit}'s own layout. */
  public static KitLayout of(KitSpec kit) {
    var slots = new TreeMap<Integer, Integer>();
    for (var placement : kit.layout()) {
      slots.put(placement.index(), placement.slot());
    }
    return new KitLayout(slots);
  }

  /**
   * Whether this layout places exactly {@code kit}'s items, with the Bomb Fuse still in its locked
   * slot 0.
   */
  public boolean fits(KitSpec kit) {
    return slots.keySet().equals(of(kit).slots().keySet())
        && Integer.valueOf(0).equals(slots.get(0));
  }

  /**
   * Where {@code kit}'s items go under the saved layout, or under the kit's own layout when the
   * saved one does not fit it (or there is none).
   */
  public static List<KitSpec.Placement> place(KitSpec kit, Optional<KitLayout> saved) {
    var layout = saved.filter(candidate -> candidate.fits(kit)).orElseGet(() -> of(kit));
    var items = kit.items();
    var placed = new ArrayList<KitSpec.Placement>();
    for (var entry : new TreeMap<>(layout.slots()).entrySet()) {
      placed.add(
          new KitSpec.Placement(entry.getKey(), entry.getValue(), items.get(entry.getKey())));
    }
    return List.copyOf(placed);
  }
}
