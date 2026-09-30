package com.shepherdjerred.thestorm.spells.domain.config;

import java.util.regex.Pattern;

/**
 * Single-use scrolls: any spell can be written on one. Reading takes a moment, like drinking a
 * potion, and the scroll is consumed only when the spell goes off.
 *
 * @param model the scroll's {@code item_model} key
 * @param readSeconds how long reading takes
 * @param sound the sound event played when a scroll is read
 * @param maxStack how many scrolls of one spell stack together
 */
public record ScrollConfig(String model, double readSeconds, String sound, int maxStack) {

  private static final Pattern SOUND = Pattern.compile("[a-z0-9_.]+");

  public ScrollConfig {
    SpellLook.requireModelKey("scroll.model", model);
    Checks.between("scroll.readSeconds", readSeconds, 0.05, 10);
    if (!SOUND.matcher(sound).matches()) {
      throw new IllegalArgumentException("scroll.sound must be a sound event key: " + sound);
    }
    Checks.between("scroll.maxStack", maxStack, 1, 99);
  }
}
