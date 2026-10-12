package com.shepherdjerred.thestorm.rwfbots.app;

import com.shepherdjerred.thestorm.rwfbots.domain.reflex.Loadout;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Kit;

/**
 * Where the rwf kits put their items: the Bomb Fuse is locked in hotbar slot 0, the weapon follows
 * in slot 1, and the bow or the golden apples sit in slot 2.
 */
public final class Loadouts {

  /** The hotbar slot rwf locks the Bomb Fuse into. */
  public static final int FUSE_SLOT = 0;

  public static final int WEAPON_SLOT = 1;

  public static final int SECOND_SLOT = 2;

  private Loadouts() {}

  public static Loadout rwf(Kit kit) {
    return new Loadout(
        WEAPON_SLOT,
        kit.hasBow() ? SECOND_SLOT : -1,
        kit.hasGapples() ? SECOND_SLOT : -1,
        FUSE_SLOT);
  }
}
