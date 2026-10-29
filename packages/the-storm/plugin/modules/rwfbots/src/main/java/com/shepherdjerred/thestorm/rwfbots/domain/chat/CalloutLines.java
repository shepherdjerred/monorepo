package com.shepherdjerred.thestorm.rwfbots.domain.chat;

import com.shepherdjerred.thestorm.rwfbots.domain.personality.Personality;
import com.shepherdjerred.thestorm.rwfbots.domain.team.Callout;
import java.util.EnumMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.random.RandomGenerator;

/**
 * Puts a {@link Callout} into words, short as a player types in a fight, in the speaker's voice: a
 * terse or quiet personality says the fewest words, a loud one shouts, and one whose style is
 * lowercase types in lowercase. Placeholders: {@code {place}}, {@code {name}} (the human addressed
 * or the teammate on the fuse) and {@code {bearing}}. Pure.
 */
public final class CalloutLines {

  /** Style notes that mean a personality types in lowercase. */
  static final List<String> LOWERCASE = List.of("lowercase", "lower-case", "lower case");

  /** Style notes that mean a personality uses as few words as it can. */
  static final List<String> TERSE = List.of("few words", "one or two words", "two-word", "terse");

  private CalloutLines() {}

  /** How a personality types its calls. */
  enum Register {
    PLAIN,
    TERSE,
    LOUD
  }

  /**
   * The line {@code speaker} types for {@code callout}; {@code name} is the display name of its
   * subject, if it has one.
   */
  public static String line(
      Callout callout,
      Optional<String> name,
      Optional<Personality> speaker,
      RandomGenerator random) {
    var register = speaker.map(CalloutLines::register).orElse(Register.PLAIN);
    var pool = pool(callout, name.isPresent() && callout.subject().isPresent(), register);
    var template = pool.get(random.nextInt(pool.size()));
    if (speaker.filter(CalloutLines::lowercase).isPresent())
      template = template.toLowerCase(Locale.ROOT);
    var text =
        template
            .replace("{place}", callout.place())
            .replace("{name}", name.orElse(""))
            .replace("{bearing}", callout.bearing().orElse("close"));
    if (register == Register.LOUD && !text.endsWith("!")) text = text + "!";
    return text;
  }

  static Register register(Personality bot) {
    var style = bot.voice().style().toLowerCase(Locale.ROOT);
    var tones = bot.voice().toneTags();
    if (TERSE.stream().anyMatch(style::contains)
        || tones.stream().anyMatch(Chattiness.QUIET_TONES::contains)) return Register.TERSE;
    if (tones.stream().anyMatch(Chattiness.LOUD_TONES::contains)) return Register.LOUD;
    return Register.PLAIN;
  }

  static boolean lowercase(Personality bot) {
    var style = bot.voice().style().toLowerCase(Locale.ROOT);
    return LOWERCASE.stream().anyMatch(style::contains);
  }

  /**
   * One kind's phrasings: plain and terse, each for a call about a place and for one that names its
   * subject.
   */
  private record Pools(
      List<String> plain, List<String> terse, List<String> named, List<String> namedTerse) {

    static Pools of(List<String> plain, List<String> terse) {
      return new Pools(plain, terse, plain, terse);
    }

    List<String> pick(boolean byName, boolean briefly) {
      if (byName) return briefly ? namedTerse : named;
      return briefly ? terse : plain;
    }
  }

  private static final Map<Callout.Kind, Pools> POOLS = pools();

  private static Map<Callout.Kind, Pools> pools() {
    var out = new EnumMap<Callout.Kind, Pools>(Callout.Kind.class);
    out.put(
        Callout.Kind.ENEMY_PLANTING,
        Pools.of(
            List.of("They're planting {place}!", "{place} getting planted!"),
            List.of("they're on {place}", "{place} planted")));
    out.put(
        Callout.Kind.NEED_DEFUSE,
        Pools.of(
            List.of("Need a defuse on {place}!", "Someone defuse {place}!"),
            List.of("defuse {place}", "defuse!")));
    out.put(
        Callout.Kind.RETAKING,
        Pools.of(
            List.of("Our bomb's lit, retake!", "Retake {place}!"),
            List.of("retake", "{place} lit")));
    out.put(
        Callout.Kind.DEFUSING,
        new Pools(
            List.of("Defusing, cover me!", "On the defuse, cover!"),
            List.of("defusing", "on it"),
            List.of("Cover {name}, defusing!", "{name}'s defusing, cover"),
            List.of("cover {name}")));
    out.put(
        Callout.Kind.PLANTING,
        new Pools(
            List.of("Planting {place}, cover!", "Planting, cover me!"),
            List.of("planting", "going {place}"),
            List.of("Cover {name}, planting!", "{name}'s planting, cover"),
            List.of("cover {name}")));
    out.put(
        Callout.Kind.COVERING,
        new Pools(
            List.of("Covering!"),
            List.of("covering"),
            List.of("On you, {name}!", "Covering you, {name}"),
            List.of("got you {name}", "on you {name}")));
    out.put(
        Callout.Kind.HELPING,
        new Pools(
            List.of("Coming!"),
            List.of("coming"),
            List.of("Coming, {name}!", "On my way, {name}"),
            List.of("coming {name}", "omw {name}")));
    out.put(
        Callout.Kind.NEED_HELP,
        Pools.of(List.of("Help at {place}!", "Need help {place}!"), List.of("help", "help pls")));
    out.put(
        Callout.Kind.ENEMY,
        new Pools(
            List.of("Enemy at {place}!", "One at {place}!"),
            List.of("{place}", "one at {place}"),
            List.of("{name}, one {bearing}!", "Enemy {bearing}, {name}!"),
            List.of("{name} {bearing}", "{name} one {bearing}")));
    return Map.copyOf(out);
  }

  /** The phrasings for {@code callout}; a sighting names its human only with a bearing. */
  private static List<String> pool(Callout callout, boolean named, Register register) {
    var byName = named && (callout.kind() != Callout.Kind.ENEMY || callout.bearing().isPresent());
    return java.util.Objects.requireNonNull(POOLS.get(callout.kind()))
        .pick(byName, register == Register.TERSE);
  }
}
