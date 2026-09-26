package com.shepherdjerred.thestorm.towns.domain.pvp;

import com.shepherdjerred.thestorm.core.result.Result;
import java.time.Duration;
import java.time.Instant;
import java.util.Optional;

/**
 * The personal PvP switch. Everyone starts with PvP on. A player may turn it off (or back on), but
 * only once per cooldown, and never within a short while of a fight, so nobody flips it to escape
 * one; their first change is free of the cooldown but not of the fight rule.
 */
public final class PvpRules {

  private PvpRules() {}

  /**
   * When a change may happen.
   *
   * @param cooldown how long after a change the next may be made
   * @param fightUntil until when the player counts as fighting, if they fought recently
   */
  public record Timing(Duration cooldown, Optional<Instant> fightUntil) {}

  /** Whether a player with {@code setting} (empty if they never changed it) fights players. */
  public static boolean isOn(Optional<PvpSetting> setting) {
    return setting.map(PvpSetting::on).orElse(true);
  }

  /**
   * When a player with {@code setting} may next change it: empty if they may now or have never
   * changed it.
   */
  public static Optional<Instant> nextChange(
      Optional<PvpSetting> setting, Instant now, Duration cooldown) {
    return setting
        .map(current -> current.changedAt().plus(cooldown))
        .filter(next -> now.isBefore(next));
  }

  /** The player's new setting after asking for {@code on} at {@code now}. */
  public static Result<PvpSetting, PvpProblem> change(
      Optional<PvpSetting> current, boolean on, Instant now, Timing timing) {
    if (isOn(current) == on) {
      return Result.err(new PvpProblem.AlreadySet(on));
    }
    var fight = timing.fightUntil().filter(until -> now.isBefore(until));
    if (fight.isPresent()) {
      return Result.err(new PvpProblem.InFight(fight.get()));
    }
    var next = nextChange(current, now, timing.cooldown());
    if (next.isPresent()) {
      return Result.err(new PvpProblem.TooSoon(next.get()));
    }
    return Result.ok(new PvpSetting(on, now));
  }
}
