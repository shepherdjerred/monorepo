// Ported from libraryaddict's Red Warfare
// (redwarfare-arcade/src/me/libraryaddict/arcade/game/searchanddestroy/TeamBomb.java);
// see packages/the-storm/NOTICE.
package com.shepherdjerred.thestorm.rwf.domain.bomb;

import static java.util.Comparator.comparing;

import com.shepherdjerred.thestorm.core.result.Result;
import com.shepherdjerred.thestorm.rwf.domain.bomb.BombState.Armed;
import com.shepherdjerred.thestorm.rwf.domain.bomb.BombState.Destroyed;
import com.shepherdjerred.thestorm.rwf.domain.bomb.BombState.Idle;
import com.shepherdjerred.thestorm.rwf.domain.combatant.TeamColor;
import com.shepherdjerred.thestorm.rwf.domain.map.BombOwner;
import com.shepherdjerred.thestorm.rwf.domain.map.BombSite;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Optional;

/**
 * A bomb on the map and its state. Clicks and ticks give the next state and what happened, so the
 * match can announce it and act on explosions.
 *
 * <p>Rules, as Red Warfare had them: a team cannot arm its own bomb or defuse an enemy's armed
 * bomb; anyone may arm a nuke, after which it belongs to that team, who cannot defuse it. Several
 * teams may work on one bomb at once and the earliest to finish wins. Once armed the fuse is {@link
 * #FUSE_SECONDS}; the first second burns on the first tick after arming, so the TNT goes off {@code
 * FUSE_SECONDS - 1} seconds after it was armed, exactly as the original did.
 *
 * @param site where the bomb is and who owns it
 * @param state where it is in its life
 */
public record Bomb(BombSite site, BombState state) {

  /** The fuse once armed. */
  public static final int FUSE_SECONDS = 60;

  /** Solid blocks within this many blocks of an exploded bomb become coal. */
  public static final int CRATER_RADIUS = 6;

  private static final Comparator<ArmAttempt> EARLIEST_FINISH = comparing(ArmAttempt::finishesAt);

  /** An unarmed bomb at {@code site}. */
  public static Bomb at(BombSite site) {
    return new Bomb(site, Idle.EMPTY);
  }

  public String id() {
    return site.id();
  }

  public boolean isNuke() {
    return site.owner().isNuke();
  }

  public boolean armed() {
    return state instanceof Armed;
  }

  public boolean destroyed() {
    return state instanceof Destroyed;
  }

  /** The team the bomb belongs to now: its owner, or for a nuke the team that armed it. */
  public Optional<TeamColor> team() {
    return switch (site.owner()) {
      case BombOwner.Team(var color) -> Optional.of(color);
      case BombOwner.Nuke _ ->
          state instanceof Armed armed ? Optional.of(armed.team()) : Optional.empty();
    };
  }

  /** A living combatant right-clicks the bomb with a fuse. */
  public Result<Step, BombError> click(BombClick click) {
    return switch (state) {
      case Destroyed _ -> Result.err(BombError.DESTROYED);
      case Idle idle ->
          team().filter(owner -> owner == click.team()).isPresent()
              ? Result.err(BombError.CANNOT_ARM_OWN_BOMB)
              : Result.ok(attempt(BombAction.ARM, idle.attempts(), click));
      case Armed armed -> {
        if (armed.team() != click.team()) {
          yield isNuke()
              ? Result.ok(attempt(BombAction.DEFUSE, armed.attempts(), click))
              : Result.err(BombError.CANNOT_DEFUSE_ENEMY_BOMB);
        }
        yield isNuke()
            ? Result.err(BombError.CANNOT_DEFUSE_OWN_NUKE)
            : Result.ok(attempt(BombAction.DEFUSE, armed.attempts(), click));
      }
    };
  }

  private Step attempt(BombAction action, List<ArmAttempt> attempts, BombClick click) {
    var live = new ArrayList<ArmAttempt>();
    var found = false;
    for (var attempt : attempts) {
      if (!attempt.valid(click.now())) {
        continue;
      }
      if (attempt.team() == click.team()) {
        found = true;
        live.add(attempt.click(click.clicker(), click.fuse(), click.now()));
      } else {
        live.add(attempt);
      }
    }
    if (!found) {
      live.add(
          ArmAttempt.begin(click.team(), action, click.now())
              .click(click.clicker(), click.fuse(), click.now()));
    }
    return withAttempts(live).settle(click.now());
  }

  /** A tick: lapsed attempts drop, finished ones take effect, and an armed fuse burns. */
  public Step tick(Instant now) {
    if (state instanceof Destroyed) {
      return new Step(this, List.of());
    }
    var live = state.attempts().stream().filter(attempt -> attempt.valid(now)).toList();
    var settled = withAttempts(live).settle(now);
    if (!settled.outcomes().isEmpty() || !(settled.bomb().state() instanceof Armed armed)) {
      return settled;
    }
    return settled.bomb().burn(armed, now);
  }

  private Bomb withAttempts(List<ArmAttempt> attempts) {
    return switch (state) {
      case Idle _ -> new Bomb(site, new Idle(attempts));
      case Armed armed ->
          new Bomb(site, new Armed(armed.team(), armed.fusedAt(), armed.remaining(), attempts));
      case Destroyed destroyed -> new Bomb(site, destroyed);
    };
  }

  /** Applies the earliest finished attempt, if any. */
  private Step settle(Instant now) {
    var first = state.attempts().stream().min(EARLIEST_FINISH);
    if (first.isEmpty() || !first.orElseThrow().finished(now)) {
      return new Step(this, List.of());
    }
    var winner = first.orElseThrow();
    return switch (state) {
      case Idle _ ->
          new Step(
              new Bomb(
                  site,
                  new Armed(
                      site.owner().team().orElseGet(winner::team), now, FUSE_SECONDS, List.of())),
              List.of(new BombOutcome.Armed(winner.team(), winner.clickers())));
      case Armed _ ->
          new Step(restore(), List.of(new BombOutcome.Defused(winner.team(), winner.clickers())));
      case Destroyed _ -> throw new IllegalStateException("a destroyed bomb has no attempts");
    };
  }

  private Step burn(Armed armed, Instant now) {
    var outcomes = new ArrayList<BombOutcome>();
    var remaining = armed.remaining();
    while (remaining > 0 && now.isAfter(armed.fusedAt().plusSeconds(FUSE_SECONDS - remaining))) {
      remaining--;
      outcomes.add(new BombOutcome.Burned(remaining, announced(remaining)));
      if (remaining == 0) {
        outcomes.add(new BombOutcome.Exploded());
      }
    }
    var next = new Bomb(site, new Armed(armed.team(), armed.fusedAt(), remaining, List.of()));
    return new Step(remaining == armed.remaining() ? this : next, outcomes);
  }

  /** Whether Red Warfare announced this many seconds left: 30, 20, 10 and every second from 5. */
  public static boolean announced(int remaining) {
    return remaining > 0 && (remaining <= 5 || (remaining <= 30 && remaining % 10 == 0));
  }

  /**
   * Puts the TNT block back with a full fuse; a nuke loses its team. Unarmed bombs are unchanged.
   */
  public Bomb restore() {
    return armed() ? new Bomb(site, Idle.EMPTY) : this;
  }

  /** Removes the bomb for the rest of the match. */
  public Bomb destroy() {
    return new Bomb(site, new Destroyed());
  }

  /**
   * The result of a click or a tick.
   *
   * @param bomb the bomb afterwards
   * @param outcomes what happened, in order
   */
  public record Step(Bomb bomb, List<BombOutcome> outcomes) {

    public Step {
      outcomes = List.copyOf(outcomes);
    }
  }
}
