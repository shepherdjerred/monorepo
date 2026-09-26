package com.shepherdjerred.thestorm.arena.domain.reward;

import java.time.DateTimeException;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.HashSet;
import java.util.List;
import java.util.Optional;

/**
 * The vault-style bonus: reaching the end of a milestone wave opens a vault for each fighter, once
 * per player per milestone per day. What it holds is given after the player leaves the arena.
 *
 * @param zone the time zone whose midnight starts a new day, such as {@code America/New_York}
 * @param milestones the waves that open a vault
 */
public record VaultSettings(String zone, List<VaultMilestone> milestones) {

  public VaultSettings {
    try {
      ZoneId.of(zone);
    } catch (DateTimeException e) {
      throw new IllegalArgumentException("unknown time zone: " + zone, e);
    }
    var waves = new HashSet<Integer>();
    for (var milestone : milestones) {
      if (!waves.add(milestone.wave())) {
        throw new IllegalArgumentException("wave " + milestone.wave() + " has two milestones");
      }
    }
    milestones = List.copyOf(milestones);
  }

  /** The milestone at {@code wave}, if any. */
  public Optional<VaultMilestone> at(int wave) {
    return milestones.stream().filter(milestone -> milestone.wave() == wave).findFirst();
  }

  /** The vault day {@code instant} falls on. */
  public LocalDate day(Instant instant) {
    return instant.atZone(ZoneId.of(zone)).toLocalDate();
  }
}
