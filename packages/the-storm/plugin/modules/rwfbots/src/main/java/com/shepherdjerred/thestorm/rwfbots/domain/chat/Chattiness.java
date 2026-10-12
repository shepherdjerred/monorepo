package com.shepherdjerred.thestorm.rwfbots.domain.chat;

import com.shepherdjerred.thestorm.rwfbots.domain.personality.Archetype;
import com.shepherdjerred.thestorm.rwfbots.domain.personality.Lines.Moment;
import com.shepherdjerred.thestorm.rwfbots.domain.personality.Personality;
import com.shepherdjerred.thestorm.rwfbots.domain.personality.Quirk;
import java.util.EnumMap;
import java.util.Map;
import java.util.Objects;
import java.util.Set;

/**
 * The chance a bot speaks at a moment: the configured base chance for the moment, times its
 * verbosity factor, its archetype's leaning, its tone, its chat quirks and, for a line aimed at a
 * rival or a grudge, the rival boost; capped at 1.
 */
public final class Chattiness {

  /** Tone tags that make a bot speak up a little more often. */
  static final Set<String> LOUD_TONES =
      Set.of("loud", "hype", "cocky", "verbose", "theatrical", "giddy", "smug", "upbeat");

  /** Tone tags that make a bot speak up a little less often. */
  static final Set<String> QUIET_TONES =
      Set.of("quiet", "terse", "stoic", "hushed", "solemn", "serene", "patient");

  static final double LOUD_TONE = 1.25;
  static final double QUIET_TONE = 0.75;

  private Chattiness() {}

  /**
   * What makes this line special.
   *
   * @param aimed the line is aimed at a rival (or, for {@link Quirk#HOLDS_GRUDGES}, at whoever last
   *     killed the bot)
   * @param nuke the moment is a nuke being armed
   */
  public record Context(boolean aimed, boolean nuke) {
    public static final Context PLAIN = new Context(false, false);
  }

  /** The chance, 0..1, that {@code bot} speaks at {@code moment}. */
  public static double chance(
      ChatSettings settings, Personality bot, Moment moment, Context context) {
    if (alwaysSpeaks(bot, moment)) {
      return 1;
    }
    var chance =
        settings.chance(moment)
            * settings.verbosity(bot.voice().verbosity())
            * archetype(bot.archetype(), moment)
            * tone(bot)
            * quirks(bot.quirks(), moment, context);
    if (context.aimed()) {
      chance *= settings.rivalBoost();
    }
    return Math.min(1, chance);
  }

  /** Whether {@code bot} speaks at {@code moment} whatever the dice say: gg after every match. */
  public static boolean alwaysSpeaks(Personality bot, Moment moment) {
    return bot.quirks().contains(Quirk.ALWAYS_GG)
        && (moment == Moment.ON_WIN || moment == Moment.ON_LOSS);
  }

  /** How each archetype leans; a moment it does not list keeps the base chance. */
  private static final Map<Archetype, Map<Moment, Double>> ARCHETYPES =
      Map.ofEntries(
          Map.entry(
              Archetype.TROLL,
              Map.of(
                  Moment.TAUNT, 2.5, Moment.ON_KILL, 1.5, Moment.ON_DEATH, 1.5, Moment.GREET, 1.5)),
          Map.entry(
              Archetype.TACTICIAN,
              Map.of(
                  Moment.TAUNT,
                  0.25,
                  Moment.ON_KILL,
                  0.5,
                  Moment.ON_DEATH,
                  0.5,
                  Moment.GREET,
                  0.75)),
          Map.entry(Archetype.DUELIST, Map.of(Moment.ON_KILL, 1.4, Moment.TAUNT, 1.2)),
          Map.entry(Archetype.RUSHER, Map.of(Moment.TAUNT, 1.2, Moment.GREET, 1.2)),
          Map.entry(Archetype.SNIPER, Map.of(Moment.ON_KILL, 1.2)),
          Map.entry(Archetype.HUNTER, Map.of(Moment.ON_KILL, 1.2)),
          Map.entry(Archetype.BOMB_DIVER, Map.of(Moment.ON_PLANT, 1.5)),
          Map.entry(Archetype.ANCHOR, Map.of(Moment.ON_DEFUSE, 1.5)),
          Map.entry(Archetype.LURKER, Map.of(Moment.TAUNT, 0.6)),
          Map.entry(Archetype.TURTLE, Map.of(Moment.TAUNT, 0.6)),
          Map.entry(Archetype.SUPPORT, Map.of(Moment.ON_LAST_ALIVE, 1.3)),
          Map.entry(Archetype.FLANKER, Map.of()));

  /**
   * The quirks that change chat, and how; the rest of the vocabulary is about play. {@code
   * LOVES_NUKE} and {@code ALWAYS_GG} are handled on their own, and {@code HOLDS_GRUDGES} through
   * {@link Context#aimed()}.
   */
  private static final Map<Quirk, Map<Moment, Double>> QUIRKS =
      Map.of(
          Quirk.BLAMES_LAG, Map.of(Moment.ON_DEATH, 2.0),
          Quirk.GOOD_SPORT, Map.of(Moment.ON_DEATH, 1.5, Moment.ON_LOSS, 1.5),
          Quirk.SAYS_SORRY, Map.of(Moment.ON_DEATH, 1.25),
          Quirk.CELEBRATES_EARLY, Map.of(Moment.ON_PLANT, 2.0, Moment.ON_KILL, 1.25),
          Quirk.CALLS_EVERYTHING, Map.of(Moment.TAUNT, 1.5, Moment.GREET, 1.25),
          Quirk.NARRATES, every(1.25));

  static final double NUKE_LOVE = 2;

  private static Map<Moment, Double> every(double factor) {
    var all = new EnumMap<Moment, Double>(Moment.class);
    for (var moment : Moment.values()) {
      all.put(moment, factor);
    }
    return Map.copyOf(all);
  }

  /** How an archetype leans: trolls taunt, tacticians mostly keep comms clean. */
  static double archetype(Archetype archetype, Moment moment) {
    var leaning =
        Objects.requireNonNull(ARCHETYPES.get(archetype), "every archetype has a leaning row");
    return leaning.getOrDefault(moment, 1.0);
  }

  static double tone(Personality bot) {
    var tags = bot.voice().toneTags();
    var loud = tags.stream().anyMatch(LOUD_TONES::contains);
    var quiet = tags.stream().anyMatch(QUIET_TONES::contains);
    if (loud == quiet) {
      return 1;
    }
    return loud ? LOUD_TONE : QUIET_TONE;
  }

  static double quirks(Set<Quirk> quirks, Moment moment, Context context) {
    var factor = 1.0;
    for (var quirk : quirks) {
      factor *= QUIRKS.getOrDefault(quirk, Map.of()).getOrDefault(moment, 1.0);
    }
    if (quirks.contains(Quirk.LOVES_NUKE) && moment == Moment.ON_PLANT && context.nuke()) {
      factor *= NUKE_LOVE;
    }
    return factor;
  }
}
