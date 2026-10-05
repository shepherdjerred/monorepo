package com.shepherdjerred.thestorm.rwfbots.app;

import com.shepherdjerred.thestorm.rwfbots.domain.team.TeamPlan;
import com.shepherdjerred.thestorm.rwfbots.domain.world.CombatantId;
import com.shepherdjerred.thestorm.rwfbots.domain.world.TeamId;
import java.util.Map;
import java.util.Optional;

/**
 * Everything one think job published: a thought per bot and how the job went. Immutable, so the
 * main thread reads it with one volatile read and the worker never touches it again.
 *
 * @param tick the snapshot tick the job thought from
 * @param thoughts the standing thought of every bot the job knew
 * @param thinkNanos how long the job took
 * @param perceived how many bots perceived this job
 * @param thought how many bots ran tactics this job
 * @param deferred how many due perceptions the ray budget pushed to the next job
 * @param plans each team's playbook slots and who holds them, for debugging
 */
public record DecisionBoard(
    long tick,
    Map<CombatantId, BotThought> thoughts,
    long thinkNanos,
    int perceived,
    int thought,
    int deferred,
    Map<TeamId, TeamPlan> plans) {

  /** The board before any job has run. */
  public static final DecisionBoard EMPTY = new DecisionBoard(0, Map.of(), 0, 0, 0, 0, Map.of());

  public DecisionBoard {
    thoughts = Map.copyOf(thoughts);
    plans = Map.copyOf(plans);
    if (tick < 0 || thinkNanos < 0 || perceived < 0 || thought < 0 || deferred < 0) {
      throw new IllegalArgumentException("board counters must not be negative");
    }
  }

  public Optional<BotThought> of(CombatantId bot) {
    return Optional.ofNullable(thoughts.get(bot));
  }
}
