package com.shepherdjerred.thestorm.rwfbots.domain.reflex;

import com.shepherdjerred.thestorm.rwfbots.domain.world.Kit;
import com.shepherdjerred.thestorm.rwfbots.domain.world.KitMove;
import java.util.List;

/**
 * Which hotbar slot holds what. Slots that a kit lacks are -1.
 *
 * @param swordSlot the melee weapon
 * @param bowSlot the bow, or -1
 * @param gappleSlot the golden apples, or -1
 * @param fuseSlot the blaze powder fuse
 * @param kitItems the kit items the bot uses, each in its slot
 * @param body how the kit's body moves to feed a passive power
 */
public record Loadout(
    int swordSlot,
    int bowSlot,
    int gappleSlot,
    int fuseSlot,
    List<KitItem> kitItems,
    Kit.Body body) {

  /**
   * A kit item and where it sits.
   *
   * @param move how the bot uses it
   * @param slot its hotbar slot
   */
  public record KitItem(KitMove move, int slot) {

    public KitItem {
      check(slot, false);
    }
  }

  public Loadout {
    check(swordSlot, false);
    check(bowSlot, true);
    check(gappleSlot, true);
    check(fuseSlot, false);
    kitItems = List.copyOf(kitItems);
  }

  private static void check(int slot, boolean optional) {
    if (slot < (optional ? -1 : 0) || slot > 8) {
      throw new IllegalArgumentException("slot must be 0..8" + (optional ? " or -1" : "") + slot);
    }
  }

  /** The milestone-one hotbar layout for {@code kit}: sword, bow or apples, fuse; no kit items. */
  public static Loadout standard(Kit kit) {
    return new Loadout(
        0, kit.hasBow() ? 1 : -1, kit.hasGapples() ? 1 : -1, 2, List.of(), kit.body());
  }

  public boolean hasBow() {
    return bowSlot >= 0;
  }

  public boolean hasGapples() {
    return gappleSlot >= 0;
  }
}
