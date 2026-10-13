package com.shepherdjerred.thestorm.rwf.app;

import com.shepherdjerred.thestorm.rwf.domain.ability.KitCombat;

/** Actual kit movement rules exposed to controller adapters through rwf's app boundary. */
public final class KitMovement {
  private KitMovement() {}

  public static boolean maySprint(String realKit) {
    return KitCombat.maySprint(realKit);
  }
}
