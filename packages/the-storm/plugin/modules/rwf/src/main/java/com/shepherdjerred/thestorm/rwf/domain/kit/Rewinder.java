// Ported from libraryaddict's Red Warfare
// (redwarfare-arcade/src/me/libraryaddict/arcade/game/searchanddestroy/abilities/RewinderAbility.java);
// see packages/the-storm/NOTICE.
package com.shepherdjerred.thestorm.rwf.domain.kit;

import com.shepherdjerred.thestorm.core.result.Result;
import com.shepherdjerred.thestorm.rwf.domain.geometry.Vec3;
import java.time.Duration;
import java.time.Instant;

/**
 * The Rewind kit's Time Machine: a trail of past positions and a cooldown. Using it sends the
 * player to the oldest position in the trail, clears the trail, puts out fire and fall damage (the
 * adapter's job, signalled by {@link Rewind}) and starts a {@link #COOLDOWN}. The clock starts on
 * cooldown when the match goes live, as the original did.
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

  /** Records a safe position. */
  public Rewinder track(Vec3 position, Instant now) {
    return new Rewinder(trail.record(position, now), readyAt);
  }

  /** The player died: the trail is forgotten. */
  public Rewinder died() {
    return new Rewinder(trail.cleared(), readyAt);
  }

  public boolean ready(Instant now) {
    return !now.isBefore(readyAt);
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
   * @param to where to teleport the player, extinguished and with no fall distance
   * @param next the clock afterwards
   */
  public record Rewind(Vec3 to, Rewinder next) {}
}
