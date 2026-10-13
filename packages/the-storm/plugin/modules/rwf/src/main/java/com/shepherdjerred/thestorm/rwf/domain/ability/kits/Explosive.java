// Ported from libraryaddict's Red Warfare
// (redwarfare-arcade/src/me/libraryaddict/arcade/game/searchanddestroy/abilities/
// ExplosiveAbility.java); see packages/the-storm/NOTICE.
package com.shepherdjerred.thestorm.rwf.domain.ability.kits;

import com.shepherdjerred.thestorm.rwf.domain.ability.Ability;
import com.shepherdjerred.thestorm.rwf.domain.ability.AbilityEffect;
import com.shepherdjerred.thestorm.rwf.domain.ability.AbilityInput;
import com.shepherdjerred.thestorm.rwf.domain.ability.Arena;
import com.shepherdjerred.thestorm.rwf.domain.ability.Fighter;
import com.shepherdjerred.thestorm.rwf.domain.ability.KitAttacks;
import com.shepherdjerred.thestorm.rwf.domain.ability.KitState;
import com.shepherdjerred.thestorm.rwf.domain.kit.ItemSpec;
import com.shepherdjerred.thestorm.rwf.domain.kit.KitBook;
import java.time.Duration;

/**
 * The Explosive. An RPG flies like an arrow until it hits, then explodes (power 6.5, at most 20
 * damage, no block damage), throwing its firer back; the launcher recharges for 30 seconds, and an
 * Explosive caught in its own RPG takes 4 more and credits nobody. Grenades are thrown from five 5-
 * second charges, so up to five fly at once, and explode 3 seconds after the throw (power 5.5, at
 * most 16); a dead thrower's grenade only bangs, hurting nobody, which the server does alone. On
 * Red Warfare's one-second clock, once the restock has recharged and fewer than 20 grenades are
 * held, one more arrives and the restock recharges for 13 seconds (8 at the start of the match).
 */
public final class Explosive implements Ability {

  public static final String ID = "explosive";

  public static final String RPG = "rpg";
  public static final Duration RPG_RECHARGE = Duration.ofSeconds(30);
  public static final float RPG_POWER = 6.5F;
  public static final double RPG_MOST = 20;
  public static final double SELF_EXTRA = 4;

  public static final int CHARGES = 5;
  public static final Duration CHARGE = Duration.ofSeconds(5);
  public static final Duration FUSE = Duration.ofSeconds(3);
  public static final float GRENADE_POWER = 5.5F;
  public static final double GRENADE_MOST = 16;

  public static final String RESTOCK = "grenade-restock";
  public static final Duration RESTOCK_EVERY = Duration.ofSeconds(13);
  public static final Duration FIRST_RESTOCK = Duration.ofSeconds(8);
  public static final int MOST_GRENADES = 20;

  /** The material grenades are, which the server counts once a second. */
  public static final String GRENADE_MATERIAL = "FIREWORK_STAR";

  @Override
  public String id() {
    return ID;
  }

  /** One grenade, as the kit carries it. */
  public static ItemSpec grenade() {
    return KitBook.EXPLOSIVE.hotbar().get(2).times(1);
  }

  @Override
  public KitState start(Fighter self, Arena arena) {
    arena.use(self.id(), RESTOCK, FIRST_RESTOCK, false);
    return KitState.NONE;
  }

  @Override
  public void act(Fighter self, AbilityInput input, Arena arena) {
    switch (input) {
      case AbilityInput.LaunchRpg _ -> {
        if (!arena.ready(self.id(), RPG)) {
          return;
        }
        arena.use(self.id(), RPG, RPG_RECHARGE, true);
        arena.effect(new AbilityEffect.Take(self.id(), "EGG", 1));
        arena.effect(new AbilityEffect.Launch(self.id(), AbilityEffect.Projectile.RPG));
      }
      case AbilityInput.ThrowGrenade _ -> throwGrenade(self, arena);
      case AbilityInput.Detonate detonate -> detonate(self, detonate, arena);
      case AbilityInput.Stock stock -> restock(self, stock, arena);
      default -> {}
    }
  }

  private static void throwGrenade(Fighter self, Arena arena) {
    var soonest = CHARGE;
    for (var i = 0; i < CHARGES; i++) {
      var key = "grenade" + i;
      if (arena.ready(self.id(), key)) {
        arena.use(self.id(), key, CHARGE, false);
        arena.effect(new AbilityEffect.Take(self.id(), "FIREWORK_STAR", 1));
        arena.effect(new AbilityEffect.Launch(self.id(), AbilityEffect.Projectile.GRENADE));
        return;
      }
      var left = arena.left(self.id(), key);
      if (left.compareTo(soonest) < 0) {
        soonest = left;
      }
    }
    var seconds = (long) Math.ceil(soonest.toMillis() / 1000.0);
    arena.say(
        self.id(),
        "You cannot throw another grenade for "
            + seconds
            + " second"
            + (seconds == 1 ? "" : "s")
            + "!",
        AbilityEffect.Tone.REFUSED);
  }

  private static void detonate(Fighter self, AbilityInput.Detonate detonate, Arena arena) {
    switch (detonate.projectile()) {
      case RPG ->
          arena.effect(
              new AbilityEffect.Explode(
                  detonate.at(),
                  RPG_POWER,
                  RPG_MOST,
                  self.id(),
                  KitAttacks.RPG,
                  KitAttacks.RPG_SELF,
                  SELF_EXTRA));
      case GRENADE ->
          arena.effect(
              new AbilityEffect.Explode(
                  detonate.at(),
                  GRENADE_POWER,
                  GRENADE_MOST,
                  self.id(),
                  KitAttacks.GRENADE,
                  KitAttacks.GRENADE,
                  0));
    }
  }

  /**
   * Red Warfare's once-a-second grenade check: when the restock has recharged and fewer than 20
   * grenades are held, one more, silently, and the restock recharges again.
   */
  private static void restock(Fighter self, AbilityInput.Stock stock, Arena arena) {
    if (!GRENADE_MATERIAL.equals(stock.material())
        || !arena.ready(self.id(), RESTOCK)
        || stock.held() >= MOST_GRENADES) {
      return;
    }
    arena.use(self.id(), RESTOCK, RESTOCK_EVERY, false);
    arena.effect(new AbilityEffect.Give(self.id(), grenade(), Integer.MAX_VALUE));
  }
}
