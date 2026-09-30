package com.shepherdjerred.thestorm.arena.domain.boss;

import com.shepherdjerred.thestorm.arena.domain.wave.AbilitySpec;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;

/**
 * When each of a boss's abilities is next ready. An ability first fires one cooldown after the boss
 * spawns, then once per cooldown; a late check fires it once, never several times to catch up.
 *
 * @param abilities the boss's abilities
 * @param nextAt when each ability is next ready, by index
 */
public record AbilityClock(List<AbilitySpec> abilities, List<Instant> nextAt) {

  public AbilityClock {
    if (abilities.size() != nextAt.size()) {
      throw new IllegalArgumentException("every ability needs exactly one next time");
    }
    abilities = List.copyOf(abilities);
    nextAt = List.copyOf(nextAt);
  }

  /** A clock for a boss that spawned at {@code now}. */
  public static AbilityClock start(List<AbilitySpec> abilities, Instant now) {
    return new AbilityClock(
        abilities, abilities.stream().map(ability -> now.plus(ability.cooldown())).toList());
  }

  /** The abilities ready at {@code now}, and the clock with each of them reset. */
  public Fired fire(Instant now) {
    var due = new ArrayList<AbilitySpec>();
    var next = new ArrayList<Instant>(nextAt.size());
    for (var i = 0; i < abilities.size(); i++) {
      var ability = abilities.get(i);
      if (now.isBefore(nextAt.get(i))) {
        next.add(nextAt.get(i));
      } else {
        due.add(ability);
        next.add(now.plus(ability.cooldown()));
      }
    }
    return new Fired(List.copyOf(due), new AbilityClock(abilities, next));
  }

  /**
   * The result of {@link #fire}.
   *
   * @param due the abilities to use now, in definition order
   * @param clock the clock afterwards
   */
  public record Fired(List<AbilitySpec> due, AbilityClock clock) {}
}
