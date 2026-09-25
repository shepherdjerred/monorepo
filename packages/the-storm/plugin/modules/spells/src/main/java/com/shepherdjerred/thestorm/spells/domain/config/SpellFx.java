package com.shepherdjerred.thestorm.spells.domain.config;

import java.util.regex.Pattern;

/**
 * A spell's particles and sound, checked against the server's registries at enable.
 *
 * @param particle a data-free particle name, for example {@code FLAME}
 * @param sound a sound event key, for example {@code entity.blaze.shoot}
 */
public record SpellFx(String particle, String sound) {

  private static final Pattern SOUND = Pattern.compile("[a-z0-9_.]+");

  public SpellFx {
    Checks.upperName("particle", particle);
    if (!SOUND.matcher(sound).matches()) {
      throw new IllegalArgumentException("sound must be a sound event key: " + sound);
    }
  }
}
