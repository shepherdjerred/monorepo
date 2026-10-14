package com.shepherdjerred.thestorm.rwf.domain.kit;

import java.util.regex.Pattern;

/** A native potion effect carried by a potion or tipped arrow. */
public record ItemPotion(String effect, int amplifier, int ticks) {
  private static final Pattern KEY = Pattern.compile("[a-z0-9_.-]+");

  public ItemPotion {
    if (!KEY.matcher(effect).matches() || amplifier < 0 || amplifier > 255 || ticks < 1) {
      throw new IllegalArgumentException("invalid item potion effect: " + effect);
    }
  }
}
