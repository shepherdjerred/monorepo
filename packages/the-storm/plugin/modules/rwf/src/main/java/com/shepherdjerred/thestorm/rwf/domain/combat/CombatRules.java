// Ported from libraryaddict's Red Warfare
// (redwarfare-core/src/me/libraryaddict/core/CentralManager.java,
// redwarfare-arcade/src/me/libraryaddict/arcade/managers/EventManager.java and
// redwarfare-arcade/src/me/libraryaddict/arcade/game/searchanddestroy/SearchAndDestroy.java); see
// packages/the-storm/NOTICE.
package com.shepherdjerred.thestorm.rwf.domain.combat;

import java.time.Duration;
import java.util.Optional;

/** The fixed numbers of Red Warfare combat, for the adapter to apply and recordings to name. */
public final class CombatRules {

  /**
   * Names this exact set of formulas and constants. Bump it when any rule in this package changes,
   * so a recording replays against the rules it was made under.
   */
  public static final String COMBAT_RULES_VERSION = "rwf-combat-1";

  /** Added to every player's attack speed so the 1.9 cooldown never applies. */
  public static final double ATTACK_SPEED_MODIFIER = 200;

  /** A player's maximum no-damage ticks; the hit window is half of it. */
  public static final int MAX_NO_DAMAGE_TICKS = 20;

  /** Every arrow is shrunk to this hitbox when shot. */
  public static final Hitbox PROJECTILE_HITBOX = new Hitbox(0.75F, 0.5F);

  /** Eating cooked beef heals this much at once instead of feeding. */
  public static final double STEAK_HEALTH = 8;

  /** Search and Destroy turns hunger off: food never drops. */
  public static final boolean HUNGER = false;

  /** More shots than this inside {@link #BOW_SPAM_WINDOW} are refused as bow spam. */
  public static final int BOW_SPAM_SHOTS = 3;

  public static final Duration BOW_SPAM_WINDOW = Duration.ofMillis(2500);

  private CombatRules() {}

  /**
   * How much a steak heals a player at {@code health} of {@code maxHealth}, or empty when they are
   * within a point of full and the steak is left uneaten.
   */
  public static Optional<Double> steakHeal(double health, double maxHealth) {
    if (health + 1 > maxHealth) {
      return Optional.empty();
    }
    return Optional.of(Math.min(STEAK_HEALTH, maxHealth - health));
  }

  /**
   * An entity's bounding box.
   *
   * @param width blocks
   * @param height blocks
   */
  public record Hitbox(float width, float height) {

    public Hitbox {
      if (!(width > 0) || !(height > 0)) {
        throw new IllegalArgumentException("hitbox dimensions must be positive");
      }
    }
  }
}
