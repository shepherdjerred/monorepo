package com.shepherdjerred.thestorm.rwfbots.domain.record;

import com.shepherdjerred.thestorm.rwfbots.domain.geom.Vec3;
import com.shepherdjerred.thestorm.rwfbots.domain.map.RouteResult;
import com.shepherdjerred.thestorm.rwfbots.domain.world.CombatantId;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Option;
import java.util.List;
import java.util.Optional;

/**
 * One think step, recorded so a match can be replayed and a decision explained.
 *
 * @param bot who decided
 * @param snapshotTick the tick decided from
 * @param features the inputs that mattered, quantized so traces of equal play hash equal
 * @param utilities the best options and their scores, highest first, at most five
 * @param choice what was picked
 * @param temperature the softmax temperature used
 * @param randomDraw the uniform draw that picked it
 * @param movement where the bot stood and why its route was replaced, for diagnosing stuck bots;
 *     not part of the replay hash
 */
public record DecisionTrace(
    CombatantId bot,
    long snapshotTick,
    List<Feature> features,
    List<ScoredOption> utilities,
    Option choice,
    double temperature,
    double randomDraw,
    Movement movement) {

  public static final int MAX_UTILITIES = 5;

  /** How a failed route was replaced. */
  public enum Recovery {
    /** The requested route was followed. */
    NONE,
    /** A routed step to an adjacent node. */
    STEP,
    /** A direct walk back onto the navigation graph after the step could not be routed either. */
    REENTER,
    /** Nothing reachable was found; the bot holds. */
    HOLD
  }

  /**
   * The body's state and the routing outcome of one think step.
   *
   * @param pos the bot's feet
   * @param fallDistance accumulated fall distance the router planned from
   * @param onGround whether the body stood on solid ground
   * @param routeFailure why the originally requested route could not be followed this step
   * @param recovery what replaced it; a recovery without a failure stands in for a goal that a
   *     recent failure still excludes
   */
  public record Movement(
      Vec3 pos,
      double fallDistance,
      boolean onGround,
      Optional<RouteResult.Problem> routeFailure,
      Recovery recovery) {}

  /** A quantized input, such as {@code health=7} or {@code enemyDistance=12}. */
  public record Feature(String name, int quantized) {

    public Feature {
      if (name.isBlank()) {
        throw new IllegalArgumentException("feature name must not be blank");
      }
    }
  }

  /** An option and its utility. */
  public record ScoredOption(Option option, double score) {}

  public DecisionTrace {
    features = List.copyOf(features);
    utilities = List.copyOf(utilities);
    if (utilities.size() > MAX_UTILITIES) {
      throw new IllegalArgumentException("at most five utilities in a trace");
    }
    for (var i = 1; i < utilities.size(); i++) {
      if (utilities.get(i).score() > utilities.get(i - 1).score()) {
        throw new IllegalArgumentException("utilities must be highest first");
      }
    }
    if (!(randomDraw >= 0 && randomDraw < 1)) {
      throw new IllegalArgumentException("random draw must be in [0, 1): " + randomDraw);
    }
    if (!(temperature > 0)) {
      throw new IllegalArgumentException("temperature must be positive: " + temperature);
    }
  }
}
