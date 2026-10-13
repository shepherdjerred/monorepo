// Ported from libraryaddict's Red Warfare
// (redwarfare-core/src/me/libraryaddict/core/combat/CombatLog.java, getResponsibility/validate,
// and redwarfare-arcade/src/me/libraryaddict/arcade/game/Game.java, onKillstreakDeath); see
// packages/the-storm/NOTICE.
package com.shepherdjerred.thestorm.rwf.domain.combat;

import com.shepherdjerred.thestorm.rwf.domain.combatant.CombatantId;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

/**
 * Every victim's recent damage, as Red Warfare's combat log kept it, so a death can be shared out
 * between everyone who caused it. A hit counts the damage it actually took off (never more than the
 * health the victim had); a hit is forgotten once the victim is back at full health and {@link
 * KillCredit#MEMORY} has passed since it landed. Immutable.
 *
 * @param entries each victim's hits, oldest first
 */
public record DamageLog(Map<CombatantId, List<Entry>> entries) {

  /** Below this share a killer only "stole" the kill; Red Warfare's threshold. */
  public static final double STOLEN_SHARE = 0.1;

  public static final DamageLog EMPTY = new DamageLog(Map.of());

  public DamageLog {
    var copy = new LinkedHashMap<CombatantId, List<Entry>>();
    entries.forEach((victim, hits) -> copy.put(victim, List.copyOf(hits)));
    entries = Map.copyOf(copy);
  }

  /**
   * One hit.
   *
   * @param attacker the combatant responsible, if any (the world hurts too)
   * @param damage the health it took off
   * @param cause how
   * @param at when
   */
  public record Entry(Optional<CombatantId> attacker, double damage, AttackType cause, Instant at) {

    public Entry {
      if (!(damage >= 0) || !Double.isFinite(damage)) {
        throw new IllegalArgumentException("damage must be finite and not negative: " + damage);
      }
    }
  }

  /**
   * {@code victim} took {@code hit}, having had {@code healthBefore} of {@code maxHealth}; no more
   * than the health they had is counted. Hits already healed past are forgotten first, as the
   * original's validate did.
   */
  public DamageLog hurt(CombatantId victim, Entry hit, double healthBefore, double maxHealth) {
    var at = hit.at();
    var hits = new ArrayList<Entry>();
    var healed = maxHealth - healthBefore <= 0.01;
    for (var earlier : entries.getOrDefault(victim, List.of())) {
      if (!(healed && at.isAfter(earlier.at().plus(KillCredit.MEMORY)))) {
        hits.add(earlier);
      }
    }
    var taken = Math.max(0, Math.min(healthBefore, hit.damage()));
    if (taken > 0) {
      hits.add(new Entry(hit.attacker(), taken, hit.cause(), at));
    }
    var next = new HashMap<>(entries);
    next.put(victim, hits);
    return new DamageLog(next);
  }

  /** {@code victim}'s hits are gone: they died, left or the match was reset. */
  public DamageLog forget(CombatantId victim) {
    if (!entries.containsKey(victim)) {
      return this;
    }
    var next = new HashMap<>(entries);
    next.remove(victim);
    return new DamageLog(next);
  }

  /** {@code victim}'s hits, oldest first. */
  public List<Entry> of(CombatantId victim) {
    return entries.getOrDefault(victim, List.of());
  }

  /** The last combatant to hurt {@code victim}, with when, if any did. */
  public Optional<Entry> lastAttack(CombatantId victim) {
    var hits = of(victim);
    for (var i = hits.size() - 1; i >= 0; i--) {
      if (hits.get(i).attacker().isPresent()) {
        return Optional.of(hits.get(i));
      }
    }
    return Optional.empty();
  }

  /**
   * Each attacker's share of {@code victim}'s logged damage, 0 to 1, in the order they first hurt
   * them; the victim's own damage never counts. Red Warfare's {@code getResponsibility}.
   */
  public Map<CombatantId, Double> responsibility(CombatantId victim) {
    var dealt = new LinkedHashMap<CombatantId, Double>();
    var total = 0.0;
    for (var hit : of(victim)) {
      if (hit.attacker().isEmpty() || hit.attacker().orElseThrow().equals(victim)) {
        continue;
      }
      dealt.merge(hit.attacker().orElseThrow(), hit.damage(), Double::sum);
      total += hit.damage();
    }
    var shares = new LinkedHashMap<CombatantId, Double>();
    for (var entry : dealt.entrySet()) {
      shares.put(entry.getKey(), entry.getValue() / total);
    }
    return shares;
  }
}
