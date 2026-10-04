package com.shepherdjerred.thestorm.rwfbots.adapter.citizens;

import net.citizensnpcs.api.CitizensAPI;
import net.citizensnpcs.trait.SkinTrait;

/**
 * The Citizens classes rwfbots binds to. Naming them here keeps the compile-only dependency
 * exercised by every build: {@link CitizensAPI} from {@code citizensapi} and {@link SkinTrait} from
 * {@code citizens-main}, the one class outside the API jar that bot skins need.
 */
public final class CitizensBinding {

  private CitizensBinding() {}

  /** Whether the Citizens plugin is loaded and has published its implementation. */
  public static boolean available() {
    return CitizensAPI.hasImplementation();
  }

  /** The trait that gives a bot NPC its skin. */
  public static Class<SkinTrait> skinTrait() {
    return SkinTrait.class;
  }
}
