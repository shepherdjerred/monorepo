package com.shepherdjerred.thestorm.rwfbots.domain.world;

/**
 * The arrows a combatant has for a ranged weapon that spends them. A crossbow or a bow without
 * Infinity is {@link #finite()} and counts the arrows it carries, a loaded crossbow's included. An
 * Infinity bow, a returning trident, or no ranged weapon at all never runs dry: {@link #ENDLESS}.
 *
 * @param finite whether each shot spends an arrow
 * @param arrows the arrows left, 0 when not finite
 */
public record Quiver(boolean finite, int arrows) {

  /** A weapon that never runs out, or none. */
  public static final Quiver ENDLESS = new Quiver(false, 0);

  public Quiver {
    if (arrows < 0 || (!finite && arrows != 0)) {
      throw new IllegalArgumentException("a quiver holds 0.. arrows, and only when finite");
    }
  }

  /** A finite quiver holding {@code arrows}. */
  public static Quiver of(int arrows) {
    return new Quiver(true, arrows);
  }
}
