package com.shepherdjerred.thestorm.essentials.domain.teleport;

/**
 * Staff exemptions from teleport pricing, decided from permissions at the adapter.
 *
 * @param free the teleport costs nothing
 * @param ignoresCooldown the cooldown does not apply
 */
public record Exemptions(boolean free, boolean ignoresCooldown) {

  /** No exemptions: the normal price and cooldown. */
  public static final Exemptions NONE = new Exemptions(false, false);
}
