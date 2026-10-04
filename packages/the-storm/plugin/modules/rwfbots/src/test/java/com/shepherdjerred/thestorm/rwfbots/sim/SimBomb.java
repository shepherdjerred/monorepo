package com.shepherdjerred.thestorm.rwfbots.sim;

import com.shepherdjerred.thestorm.rwfbots.domain.geom.Vec3;
import com.shepherdjerred.thestorm.rwfbots.domain.world.BombId;
import com.shepherdjerred.thestorm.rwfbots.domain.world.BombOwner;
import com.shepherdjerred.thestorm.rwfbots.domain.world.BombState;
import com.shepherdjerred.thestorm.rwfbots.domain.world.BombView;
import com.shepherdjerred.thestorm.rwfbots.domain.world.CombatantId;
import com.shepherdjerred.thestorm.rwfbots.domain.world.TeamId;
import java.util.HashMap;
import java.util.Map;
import java.util.Optional;

/**
 * A bomb with the Search and Destroy rules: arm or defuse time is ten seconds less one per unique
 * clicker, a gap over 750 ms between clicks resets the attempt, the fuse burns sixty seconds, and a
 * team's last survivor arms instantly.
 */
final class SimBomb {

  static final int RESET_GAP_TICKS = 15;
  static final int FUSE_TICKS = 1200;
  static final int BASE_SECONDS = 10;

  enum Phase {
    IDLE,
    ARMING,
    ARMED,
    DEFUSING,
    DESTROYED
  }

  final BombId id;
  final BombOwner owner;
  final Vec3 pos;
  Phase phase = Phase.IDLE;
  Optional<TeamId> armingTeam = Optional.empty();
  final Map<CombatantId, Long> clickers = new HashMap<>();
  long lastClick = -1;
  int progressTicks;
  long remaining;
  long firstClickTick = -1;
  long armedAtTick = -1;
  long defusedAtTick = -1;
  long destroyedAtTick = -1;

  SimBomb(BombId id, BombOwner owner, Vec3 pos) {
    this.id = id;
    this.owner = owner;
    this.pos = pos;
  }

  /** Lights the fuse directly, for scenarios that start armed. */
  void arm(long tick) {
    phase = Phase.ARMED;
    remaining = FUSE_TICKS;
    armedAtTick = tick;
    clickers.clear();
    progressTicks = 0;
  }

  /** A fuse click by {@code clicker} of {@code team}; {@code lastAlive} is the instant-arm rule. */
  void click(CombatantId clicker, TeamId team, long tick, boolean lastAlive) {
    var accepted = owner.isTeam(team) ? acceptDefuseClick() : acceptArmClick(team);
    if (!accepted) {
      return;
    }
    if (lastClick >= 0 && tick - lastClick > RESET_GAP_TICKS) {
      resetAttempt();
    }
    if (firstClickTick < 0) {
      firstClickTick = tick;
    }
    clickers.put(clicker, tick);
    lastClick = tick;
    if (phase == Phase.ARMING && lastAlive) {
      complete(tick);
    }
  }

  /** An owner's click counts only against a lit fuse; the first one starts the defuse. */
  private boolean acceptDefuseClick() {
    if (phase == Phase.ARMED) {
      phase = Phase.DEFUSING;
      resetAttempt();
      return true;
    }
    return phase == Phase.DEFUSING;
  }

  /** An enemy's click counts on an idle bomb or one its own team is already arming. */
  private boolean acceptArmClick(TeamId team) {
    if (phase == Phase.IDLE) {
      phase = Phase.ARMING;
      armingTeam = Optional.of(team);
      resetAttempt();
      return true;
    }
    return phase == Phase.ARMING && armingTeam.orElseThrow().equals(team);
  }

  private void resetAttempt() {
    clickers.clear();
    progressTicks = 0;
    lastClick = -1;
  }

  private int requiredTicks() {
    return Math.max(0, BASE_SECONDS - clickers.size()) * 20;
  }

  void tick(long tick) {
    switch (phase) {
      case IDLE, DESTROYED -> {}
      case ARMING, DEFUSING -> {
        if (lastClick >= 0 && tick - lastClick > RESET_GAP_TICKS) {
          phase = phase == Phase.ARMING ? Phase.IDLE : Phase.ARMED;
          armingTeam = Optional.empty();
          resetAttempt();
          return;
        }
        progressTicks++;
        if (progressTicks >= requiredTicks()) {
          complete(tick);
        }
        if (phase == Phase.DEFUSING && --remaining <= 0) {
          explode(tick);
        }
      }
      case ARMED -> {
        if (--remaining <= 0) {
          explode(tick);
        }
      }
    }
  }

  private void complete(long tick) {
    if (phase == Phase.ARMING) {
      phase = Phase.ARMED;
      remaining = FUSE_TICKS;
      armedAtTick = tick;
    } else if (phase == Phase.DEFUSING) {
      phase = Phase.IDLE;
      defusedAtTick = tick;
    }
    armingTeam = Optional.empty();
    resetAttempt();
  }

  private void explode(long tick) {
    phase = Phase.DESTROYED;
    destroyedAtTick = tick;
    resetAttempt();
  }

  boolean exploded() {
    return phase == Phase.DESTROYED;
  }

  BombView view() {
    var state =
        switch (phase) {
          case IDLE -> new BombState.Idle();
          case ARMING ->
              new BombState.Arming(armingTeam.orElseThrow(), progress(), clickers.size());
          case ARMED -> new BombState.Armed(remaining);
          case DEFUSING -> new BombState.Defusing(progress(), clickers.size(), remaining);
          case DESTROYED -> new BombState.Destroyed();
        };
    return new BombView(id, owner, pos, state);
  }

  private double progress() {
    var required = requiredTicks();
    return required == 0 ? 1 : Math.min(1, progressTicks / (double) required);
  }
}
