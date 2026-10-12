// Ported from libraryaddict's Red Warfare
// (redwarfare-arcade/src/me/libraryaddict/arcade/game/searchanddestroy/abilities/RewinderAbility.java);
// see packages/the-storm/NOTICE.
package com.shepherdjerred.thestorm.rwf.domain.kit;

import com.shepherdjerred.thestorm.core.result.Result;
import com.shepherdjerred.thestorm.rwf.domain.geometry.Vec3;
import java.time.Duration;
import java.time.Instant;
import java.util.function.Predicate;

/**
 * The Rewind kit's Time Machine: a trail of past spots and a cooldown. Using it sends the player to
 * the oldest spot in the trail, facing the way they faced there, clears the trail and starts a
 * {@link #COOLDOWN}; the adapter also ejects them, stops them, puts out fire and forgets who last
 * knocked them, as the original did. The clock starts on cooldown when the match goes live, and its
 * {@link #charge} fills the experience bar as it recharges.
 *
 * @param trail where the player has been
 * @param readyAt when the clock may next be used
 */
public record Rewinder(RewindTrail trail, Instant readyAt) {

  /** The ability id named by {@link KitSpec#ability()}. */
  public static final String ABILITY = "rewind";

  public static final Duration COOLDOWN = Duration.ofSeconds(30);

  /** A clock handed out at {@code liveAt}, on cooldown. */
  public static Rewinder start(Instant liveAt) {
    return new Rewinder(RewindTrail.empty(), liveAt.plus(COOLDOWN));
  }

  /** Records a safe spot. */
  public Rewinder track(RewindTrail.Spot spot, Instant now) {
    return new Rewinder(trail.record(spot, now), readyAt);
  }

  /** Drops what has fallen out of the window at {@code now}; see {@link RewindTrail#trimmed}. */
  public Rewinder trimmed(Instant now, Predicate<Vec3> safe) {
    return new Rewinder(trail.trimmed(now, safe), readyAt);
  }

  /** The player died: the trail is forgotten. */
  public Rewinder died() {
    return new Rewinder(trail.cleared(), readyAt);
  }

  public boolean ready(Instant now) {
    return !now.isBefore(readyAt);
  }

  /** How far the clock has recharged at {@code now}, from 0 just after a use to 1 when ready. */
  public double charge(Instant now) {
    if (ready(now)) {
      return 1;
    }
    var remaining = Duration.between(now, readyAt);
    return Math.clamp(1 - (double) remaining.toMillis() / COOLDOWN.toMillis(), 0, 1);
  }

  /** Right-click with the clock. */
  public Result<Rewind, RewindError> use(Instant now) {
    if (!ready(now)) {
      return Result.err(RewindError.COOLING_DOWN);
    }
    var landing = trail.landing();
    if (landing.isEmpty()) {
      return Result.err(RewindError.NO_LANDING);
    }
    return Result.ok(
        new Rewind(landing.orElseThrow(), new Rewinder(trail.cleared(), now.plus(COOLDOWN))));
  }

  /**
   * A successful use.
   *
   * @param to where to teleport the player, and which way they face there
   * @param next the clock afterwards
   */
  public record Rewind(RewindTrail.Spot to, Rewinder next) {}
}
