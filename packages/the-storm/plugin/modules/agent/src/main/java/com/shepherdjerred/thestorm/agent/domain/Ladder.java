package com.shepherdjerred.thestorm.agent.domain;

import com.shepherdjerred.thestorm.core.result.Result;
import java.time.Duration;
import java.util.List;

/**
 * The escalating answers to one offense, as written in {@code agent.yml}. Repeats within the window
 * climb one rung per strike; anything past the top rung repeats the top.
 *
 * @param offense what this answers
 * @param repeatWithin how long a strike counts, for example {@code 7d}
 * @param steps the rungs, first offense first
 */
public record Ladder(Offense offense, String repeatWithin, List<LadderStep> steps) {
  public Ladder {
    if (steps.isEmpty()) {
      throw new IllegalArgumentException(offense.id() + " needs at least one step");
    }
    steps = List.copyOf(steps);
    var parsed = DurationText.parse(repeatWithin);
    if (parsed instanceof Result.Err<Duration, String>(var problem)) {
      throw new IllegalArgumentException(offense.id() + " window: " + problem);
    }
  }

  /** How long a strike counts. */
  public Duration window() {
    return switch (DurationText.parse(repeatWithin)) {
      case Result.Ok<Duration, String>(var window) -> window;
      case Result.Err<Duration, String>(var problem) ->
          throw new IllegalStateException("validated window no longer parses: " + problem);
    };
  }

  /** The rung for a player with {@code strikes} strikes in the window. */
  public LadderStep evaluate(int strikes) {
    if (strikes < 0) {
      throw new IllegalArgumentException("strikes must not be negative");
    }
    return steps.get(Math.min(strikes, steps.size() - 1));
  }
}
