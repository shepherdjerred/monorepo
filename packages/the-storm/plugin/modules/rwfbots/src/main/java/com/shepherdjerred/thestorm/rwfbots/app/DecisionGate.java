package com.shepherdjerred.thestorm.rwfbots.app;

import com.shepherdjerred.thestorm.rwfbots.domain.world.CombatantId;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Decision;
import java.util.Optional;

/**
 * Decides, on the main thread, whether a thought from the board may be followed as it stands. A
 * decision made for an earlier life (the bot died, respawned, was teleported or rewound since) or
 * from a snapshot older than the allowed age degrades rather than drops: the body keeps walking the
 * path it had, lets go of its aim lock and any pending ability, and a rethink is requested.
 */
public final class DecisionGate {

  private final int maxAgeTicks;

  /** A gate that degrades decisions older than {@code maxAgeTicks}. */
  public DecisionGate(int maxAgeTicks) {
    if (maxAgeTicks < 1) {
      throw new IllegalArgumentException("max age must be at least one tick");
    }
    this.maxAgeTicks = maxAgeTicks;
  }

  public int maxAgeTicks() {
    return maxAgeTicks;
  }

  /**
   * The verdict on a thought.
   *
   * @param decision what the body follows this tick
   * @param stale whether the thought was stale and a rethink is wanted
   */
  public record Verdict(Decision decision, boolean stale) {}

  /**
   * What {@code bot} follows at {@code tick}, in life {@code epoch}, given the board's thought.
   *
   * @param thought the board's thought for the bot, if any
   * @param bot the bot
   * @param epoch the bot's current life epoch
   * @param tick the current tick
   */
  public Verdict judge(Optional<BotThought> thought, CombatantId bot, int epoch, long tick) {
    if (thought.isEmpty()) {
      return new Verdict(Decision.idle(bot, tick, epoch), true);
    }
    var decision = thought.orElseThrow().decision();
    var oldLife = thought.orElseThrow().lifeEpoch() != epoch;
    var tooOld = tick - decision.snapshotTick() > maxAgeTicks;
    if (!oldLife && !tooOld) {
      return new Verdict(decision, false);
    }
    return new Verdict(
        new Decision(
            decision.bot(),
            decision.option(),
            Optional.empty(),
            decision.waypoints(),
            decision.stance(),
            decision.bomb(),
            decision.watch(),
            Optional.empty(),
            decision.planLabel(),
            decision.snapshotTick(),
            decision.lifeEpoch()),
        true);
  }
}
