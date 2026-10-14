package com.shepherdjerred.thestorm.rwf.adapter.paper;

import com.shepherdjerred.thestorm.rwf.domain.combat.AttackType;
import com.shepherdjerred.thestorm.rwf.domain.combat.CombatRules;
import com.shepherdjerred.thestorm.rwf.domain.combat.HitWindow;
import com.shepherdjerred.thestorm.rwf.domain.combat.KillCredit;
import com.shepherdjerred.thestorm.rwf.domain.combat.Knocked;
import java.time.InstantSource;
import java.util.HashMap;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import org.bukkit.attribute.Attribute;
import org.bukkit.entity.LivingEntity;

/**
 * What the combat listener remembers between hits, so deaths can be attributed as Red Warfare
 * attributed them and the hit window compared against our own numbers rather than the server's.
 * Main thread only. Per victim it keeps:
 *
 * <ul>
 *   <li>{@link Last}: the last damage of any kind, which opens the hit window and names the death's
 *       cause and killer;
 *   <li>{@link Knock}: the original's "Fall" condition, the member whose hit sent them flying, kept
 *       through world damage until it expires, so a fall or drop into the void is theirs;
 *   <li>{@link Credit}: the newest member hit in the original's combat log, for the deaths the
 *       rules deal.
 * </ul>
 */
final class CombatTracker {

  /**
   * The last hit on a victim.
   *
   * @param damage what landed
   * @param attacker who, when a combatant
   * @param cause how
   */
  record Last(double damage, Optional<UUID> attacker, AttackType cause) {}

  /**
   * The member a victim is flying from.
   *
   * @param attacker who hit them
   * @param knocked how and when
   */
  record Knock(UUID attacker, Knocked knocked) {}

  /**
   * The newest member hit in a victim's combat log.
   *
   * @param attacker who
   * @param log when, and the world damage logged since
   */
  record Credit(UUID attacker, KillCredit log) {

    Credit withLog(KillCredit next) {
      return new Credit(attacker, next);
    }
  }

  private final InstantSource time;
  private final Map<UUID, Last> last = new HashMap<>();
  private final Map<UUID, Knock> knocks = new HashMap<>();
  private final Map<UUID, Credit> credits = new HashMap<>();
  private final Map<UUID, Window> windows = new HashMap<>();

  private record Window(int startedTick, double damage) {}

  CombatTracker(InstantSource time) {
    this.time = time;
  }

  /** The victim's invulnerability state as the rules see it. */
  HitWindow.Guard guard(LivingEntity victim) {
    if (victim.getMaximumNoDamageTicks() == 0) {
      var window = windows.get(victim.getUniqueId());
      if (window == null) {
        return HitWindow.Guard.NONE;
      }
      var elapsed = victim.getTicksLived() - window.startedTick();
      return new HitWindow.Guard(
          elapsed < 0 ? 0 : Math.max(0, CombatRules.MAX_NO_DAMAGE_TICKS - elapsed),
          window.damage());
    }
    var previous = last.get(victim.getUniqueId());
    return new HitWindow.Guard(
        Math.max(0, victim.getNoDamageTicks()), previous == null ? 0 : previous.damage());
  }

  /** A hit landed in full: a fresh window opens at {@code damage}. */
  void hit(LivingEntity victim, double damage, Optional<UUID> attacker, AttackType cause) {
    var id = victim.getUniqueId();
    var previousWindow = windows.get(id);
    var started = victim.getTicksLived();
    if (previousWindow != null
        && guard(victim).inWindow()
        && !cause.has(AttackType.Flag.IGNORE_RATE)
        && !cause.has(AttackType.Flag.INSTANT_DEATH)) {
      started = previousWindow.startedTick();
    }
    windows.put(id, new Window(started, damage));
    prune(victim);
    last.put(id, new Last(damage, attacker, cause));
    attacker.ifPresent(
        who -> {
          var now = time.instant();
          credits.put(id, new Credit(who, KillCredit.hit(now)));
          knocks.put(id, new Knock(who, new Knocked(cause, now)));
        });
  }

  /**
   * The newest member hit still in {@code victim}'s combat log, as the log stands when the rules
   * kill them.
   */
  Optional<Credit> credit(LivingEntity victim) {
    prune(victim);
    return Optional.ofNullable(credits.get(victim.getUniqueId()));
  }

  /**
   * The victim was hurt by the world (a fall, fire, the border, the poison) for {@code damage}. A
   * fall while knocked is the knocker's, shot or pushed; anything else names no killer.
   */
  void hurt(LivingEntity victim, AttackType cause, double damage) {
    var id = victim.getUniqueId();
    prune(victim);
    credits.computeIfPresent(id, (ignored, credit) -> credit.withLog(credit.log().hurt(damage)));
    var previous = last.get(id);
    var window = previous == null ? 0 : previous.damage();
    var knock = knocks.get(id);
    if (cause.equals(AttackType.FALL) && knock != null) {
      last.put(id, new Last(window, Optional.of(knock.attacker()), knock.knocked().fall()));
    } else {
      last.put(id, new Last(window, Optional.empty(), cause));
    }
  }

  /** The victim fell into the void: the knocker's, shot or pushed, while knocked; else nobody's. */
  void intoVoid(UUID victim) {
    var previous = last.get(victim);
    var window = previous == null ? 0 : previous.damage();
    var knock = knocks.get(victim);
    last.put(
        victim,
        knock == null
            ? new Last(window, Optional.empty(), AttackType.VOID)
            : new Last(window, Optional.of(knock.attacker()), knock.knocked().intoVoid()));
  }

  /** Every tick for a living fighter: the knock ends once they have settled or it has run out. */
  void tick(LivingEntity victim, boolean grounded) {
    var id = victim.getUniqueId();
    var knock = knocks.get(id);
    if (knock != null
        && knock
            .knocked()
            .expired(
                time.instant(),
                grounded,
                victim.getFallDistance(),
                victim.getVelocity().length())) {
      knocks.remove(id);
    }
  }

  /**
   * The victim stepped out of reach (the Time Machine removes the original's "Fall" condition): a
   * later fall or void is no longer the knocker's. The hit window and the combat log are kept.
   */
  void clearFallCredit(UUID victim) {
    knocks.remove(victim);
  }

  /** A kit sent the victim falling: credit its owner until the knock settles or expires. */
  void creditFall(LivingEntity victim, LivingEntity by) {
    knocks.put(
        victim.getUniqueId(),
        new Knock(by.getUniqueId(), new Knocked(AttackType.MELEE, time.instant())));
  }

  Optional<Last> last(UUID victim) {
    return Optional.ofNullable(last.get(victim));
  }

  void forget(UUID victim) {
    last.remove(victim);
    knocks.remove(victim);
    credits.remove(victim);
    windows.remove(victim);
  }

  void clear() {
    last.clear();
    knocks.clear();
    credits.clear();
    windows.clear();
  }

  /** The combat log drops a healed hit as new damage is logged (see {@link KillCredit}). */
  private void prune(LivingEntity victim) {
    var id = victim.getUniqueId();
    var credit = credits.get(id);
    if (credit != null
        && credit.log().pruned(time.instant(), missing(victim), Battlefield.grounded(victim))) {
      credits.remove(id);
    }
  }

  private static double missing(LivingEntity victim) {
    var attribute = victim.getAttribute(Attribute.MAX_HEALTH);
    if (attribute == null) {
      throw new IllegalStateException("living entities always have max health");
    }
    return Math.max(0, attribute.getValue() - victim.getHealth());
  }
}
