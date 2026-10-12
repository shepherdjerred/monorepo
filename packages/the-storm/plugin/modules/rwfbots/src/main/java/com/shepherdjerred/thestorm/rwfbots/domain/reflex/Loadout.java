package com.shepherdjerred.thestorm.rwfbots.domain.reflex;

import com.shepherdjerred.thestorm.rwfbots.domain.world.Kit;

/**
 * Which hotbar slot holds what. Slots that a kit lacks are -1.
 *
 * @param swordSlot the melee weapon
 * @param bowSlot the bow, or -1
 * @param gappleSlot the golden apples, or -1
 * @param fuseSlot the blaze powder fuse
 */
public record Loadout(int swordSlot, int bowSlot, int gappleSlot, int fuseSlot) {

  public Loadout {
    check(swordSlot, false);
    check(bowSlot, true);
    check(gappleSlot, true);
    check(fuseSlot, false);
  }

  private static void check(int slot, boolean optional) {
    if (slot < (optional ? -1 : 0) || slot > 8) {
      throw new IllegalArgumentException("slot must be 0..8" + (optional ? " or -1" : "") + slot);
    }
  }

  /** The milestone-one hotbar layout for {@code kit}: sword, bow or apples, fuse. */
  public static Loadout standard(Kit kit) {
    return new Loadout(0, kit.hasBow() ? 1 : -1, kit.hasGapples() ? 1 : -1, 2);
  }

  public boolean hasBow() {
    return bowSlot >= 0;
  }

  public boolean hasGapples() {
    return gappleSlot >= 0;
  }
}
