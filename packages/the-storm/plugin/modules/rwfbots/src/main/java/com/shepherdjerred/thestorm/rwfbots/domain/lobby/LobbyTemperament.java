package com.shepherdjerred.thestorm.rwfbots.domain.lobby;

import com.shepherdjerred.thestorm.rwfbots.domain.personality.Personality;
import com.shepherdjerred.thestorm.rwfbots.domain.personality.Quirk;
import java.util.EnumMap;
import java.util.Map;
import java.util.Objects;

/**
 * How a personality passes the time in the lobby: a positive weight per {@link Activity}, how many
 * kit switches it tends to make, and how close it walks up to people. Derived from its archetype,
 * its voice and its quirks: a troll jumps, sneaks and crowds players; a tactician browses kits and
 * stands still; a support walks up to others; crouch spammers and bunny hoppers do what their names
 * say; chatty bots seek company and quiet ones keep to themselves.
 *
 * @param weights how likely each activity is chosen, all positive
 * @param switchBias how eager it is to try other kits before the match, 0 to 1
 * @param closeness how near it stops when it walks up to someone, in blocks
 */
public record LobbyTemperament(Map<Activity, Double> weights, double switchBias, double closeness) {

  /** Where everyone starts, before archetype, voice and quirks. */
  static final Map<Activity, Double> BASE =
      Map.of(
          Activity.WANDER, 1.0,
          Activity.APPROACH, 0.8,
          Activity.BROWSE_KITS, 0.8,
          Activity.LOOK_AROUND, 1.0,
          Activity.SNEAK_TAP, 0.2,
          Activity.JUMP, 0.25,
          Activity.HANG_OUT, 0.7);

  /** The nearest and furthest a bot stops from someone it walks up to. */
  public static final double NEAREST = 1.5;

  public static final double FURTHEST = 4.0;

  public LobbyTemperament {
    var copy = new EnumMap<Activity, Double>(Activity.class);
    for (var activity : Activity.values()) {
      var weight = weights.get(activity);
      if (weight == null || !(weight > 0) || !Double.isFinite(weight)) {
        throw new IllegalArgumentException("every activity needs a positive weight: " + activity);
      }
      copy.put(activity, weight);
    }
    weights = Map.copyOf(copy);
    if (!(switchBias >= 0 && switchBias <= 1)) {
      throw new IllegalArgumentException("switchBias must be 0..1: " + switchBias);
    }
    if (!(closeness >= NEAREST && closeness <= FURTHEST)) {
      throw new IllegalArgumentException("closeness must be 1.5..4: " + closeness);
    }
  }

  /** The temperament of {@code personality}. */
  public static LobbyTemperament of(Personality personality) {
    var weights = new EnumMap<Activity, Double>(BASE);
    var switchBias = 0.35;
    var closeness = 3.0;
    switch (personality.archetype()) {
      case TROLL -> {
        scale(weights, Activity.JUMP, 4);
        scale(weights, Activity.SNEAK_TAP, 4);
        scale(weights, Activity.APPROACH, 2.5);
        scale(weights, Activity.LOOK_AROUND, 0.5);
        switchBias = 0.8;
        closeness = NEAREST;
      }
      case TACTICIAN -> {
        scale(weights, Activity.BROWSE_KITS, 3);
        scale(weights, Activity.LOOK_AROUND, 2);
        scale(weights, Activity.WANDER, 0.3);
        scale(weights, Activity.JUMP, 0.2);
        switchBias = 0.7;
      }
      case SUPPORT -> {
        scale(weights, Activity.APPROACH, 2);
        scale(weights, Activity.HANG_OUT, 2);
        closeness = 2.0;
      }
      case RUSHER -> {
        scale(weights, Activity.WANDER, 1.6);
        scale(weights, Activity.JUMP, 1.5);
      }
      case LURKER -> {
        scale(weights, Activity.HANG_OUT, 0.3);
        scale(weights, Activity.APPROACH, 0.4);
        scale(weights, Activity.WANDER, 1.5);
        closeness = FURTHEST;
      }
      case SNIPER, ANCHOR -> scale(weights, Activity.LOOK_AROUND, 1.5);
      case DUELIST -> scale(weights, Activity.APPROACH, 1.8);
      case TURTLE -> {
        scale(weights, Activity.HANG_OUT, 1.8);
        scale(weights, Activity.WANDER, 0.5);
      }
      case BOMB_DIVER, FLANKER, HUNTER -> {}
    }
    switch (personality.voice().verbosity()) {
      case CHATTY -> scale(weights, Activity.APPROACH, 1.4);
      case QUIET -> scale(weights, Activity.APPROACH, 0.7);
      case NORMAL -> {}
    }
    quirks(weights, personality.quirks());
    return new LobbyTemperament(weights, switchBias, closeness);
  }

  private static void quirks(Map<Activity, Double> weights, Iterable<Quirk> quirks) {
    for (var quirk : quirks) {
      switch (quirk) {
        case CROUCH_SPAM -> scale(weights, Activity.SNEAK_TAP, 6);
        case BUNNY_HOPS -> scale(weights, Activity.JUMP, 5);
        case SPINS, SLOW_STARTER, STARES_DOWN -> scale(weights, Activity.LOOK_AROUND, 1.5);
        default -> {}
      }
    }
  }

  private static void scale(Map<Activity, Double> weights, Activity activity, double factor) {
    weights.merge(activity, factor, (a, b) -> a * b);
  }

  /** How likely {@code activity} is chosen. */
  public double weight(Activity activity) {
    return Objects.requireNonNull(weights.get(activity), "every activity has a weight");
  }
}
