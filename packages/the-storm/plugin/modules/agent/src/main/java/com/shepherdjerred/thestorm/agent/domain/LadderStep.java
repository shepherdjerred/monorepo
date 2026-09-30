package com.shepherdjerred.thestorm.agent.domain;

import com.shepherdjerred.thestorm.core.result.Result;
import java.time.Duration;
import java.util.Optional;

/**
 * One rung of a ladder, as written in {@code agent.yml}. Actions with a length take a duration
 * ({@code 10m}); the rest take {@code none}.
 *
 * @param action what to do
 * @param duration how long, or {@code none}
 */
public record LadderStep(LadderAction action, String duration) {

  /** The duration word for actions without a length. */
  public static final String NONE = "none";

  public LadderStep {
    if (action.takesDuration() == NONE.equalsIgnoreCase(duration)) {
      throw new IllegalArgumentException(
          action.id() + " must " + (action.takesDuration() ? "name" : "not name") + " a duration");
    }
    if (action.takesDuration()) {
      var parsed = DurationText.parse(duration);
      if (parsed instanceof Result.Err<Duration, String>(var problem)) {
        throw new IllegalArgumentException(problem);
      }
    }
  }

  /** The length, for actions that take one. */
  public Optional<Duration> length() {
    if (!action.takesDuration()) {
      return Optional.empty();
    }
    return switch (DurationText.parse(duration)) {
      case Result.Ok<Duration, String>(var length) -> Optional.of(length);
      case Result.Err<Duration, String>(var problem) ->
          throw new IllegalStateException("validated duration no longer parses: " + problem);
    };
  }
}
