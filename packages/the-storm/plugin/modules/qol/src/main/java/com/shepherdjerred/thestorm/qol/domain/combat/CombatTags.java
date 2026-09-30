package com.shepherdjerred.thestorm.qol.domain.combat;

import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

/**
 * Who is in combat and until when. Immutable: every change returns new tags.
 *
 * <p>A hit between two players tags both for the tag length; another hit restarts both clocks. A
 * tag ends at its instant exactly.
 *
 * @param until when each tagged player's tag ends
 */
public record CombatTags(Map<UUID, Instant> until) {

  public CombatTags {
    until = Map.copyOf(until);
  }

  public static CombatTags none() {
    return new CombatTags(Map.of());
  }

  /**
   * {@code attacker} hit {@code victim} at {@code now}: both are tagged for {@code length}, unless
   * they already are for longer. Hurting yourself tags nobody.
   */
  public CombatTags hit(UUID attacker, UUID victim, Instant now, Duration length) {
    if (!length.isPositive()) {
      throw new IllegalArgumentException("tag length must be positive: " + length);
    }
    if (attacker.equals(victim)) {
      return this;
    }
    var ends = now.plus(length);
    var next = new HashMap<>(until);
    next.merge(attacker, ends, CombatTags::later);
    next.merge(victim, ends, CombatTags::later);
    return new CombatTags(next);
  }

  private static Instant later(Instant a, Instant b) {
    return a.isAfter(b) ? a : b;
  }

  /** How long {@code player} stays in combat, or empty if they are not. */
  public Optional<Duration> remaining(UUID player, Instant now) {
    var ends = until.get(player);
    if (ends == null || !now.isBefore(ends)) {
      return Optional.empty();
    }
    return Optional.of(Duration.between(now, ends));
  }

  public boolean isTagged(UUID player, Instant now) {
    return remaining(player, now).isPresent();
  }

  /** {@code player} is out of combat at once (they died). */
  public CombatTags clear(UUID player) {
    if (!until.containsKey(player)) {
      return this;
    }
    var next = new HashMap<>(until);
    next.remove(player);
    return new CombatTags(next);
  }

  /**
   * Tags after dropping every tag that has ended by {@code now}.
   *
   * @param tags the tags still running
   * @param ended the players whose tags just ended
   */
  public record Swept(CombatTags tags, List<UUID> ended) {

    public Swept {
      ended = List.copyOf(ended);
    }
  }

  public Swept sweep(Instant now) {
    var next = new HashMap<UUID, Instant>();
    var ended = new ArrayList<UUID>();
    until.forEach(
        (player, ends) -> {
          if (now.isBefore(ends)) {
            next.put(player, ends);
          } else {
            ended.add(player);
          }
        });
    ended.sort(UUID::compareTo);
    return new Swept(new CombatTags(next), ended);
  }
}
