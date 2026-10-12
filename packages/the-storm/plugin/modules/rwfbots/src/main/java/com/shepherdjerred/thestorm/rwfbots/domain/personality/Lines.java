package com.shepherdjerred.thestorm.rwfbots.domain.personality;

import java.util.EnumSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.regex.Pattern;

/**
 * What a personality may say in chat, as one pool per moment; a speaker picks a line from the pool.
 * Each match moment holds 2..6 lines and the lobby pool 4..8, every line at most 80 characters. A
 * line may name the people and things of its moment through placeholders, and only those: {@code
 * {victim}} in a kill line, {@code {killer}} in a death line, {@code {bomb}} in a plant or defuse
 * line, and {@code {team}} (the speaker's team) anywhere. Any other brace is an error.
 *
 * @param greet when it joins a match
 * @param onKill after it kills someone
 * @param onDeath after it dies
 * @param onPlant when it finishes arming the enemy bomb
 * @param onDefuse when it defuses its own bomb
 * @param onWin when its team wins
 * @param onLoss when its team loses
 * @param onLastAlive when it becomes the last of its team alive
 * @param taunt idle chatter aimed at the other team
 * @param lobby small talk, kit talk and team pep while waiting in the lobby before a match
 */
public record Lines(
    List<String> greet,
    List<String> onKill,
    List<String> onDeath,
    List<String> onPlant,
    List<String> onDefuse,
    List<String> onWin,
    List<String> onLoss,
    List<String> onLastAlive,
    List<String> taunt,
    List<String> lobby) {

  public static final int MIN_LINES = 2;
  public static final int MAX_LINES = 6;
  public static final int MIN_LOBBY_LINES = 4;
  public static final int MAX_LOBBY_LINES = 8;
  public static final int MAX_LINE_LENGTH = 80;

  private static final Pattern PLACEHOLDER = Pattern.compile("\\{([a-z]+)}");

  /** A value the chat layer fills in when it says a line. */
  public enum Placeholder {
    /** The name of the player this bot just killed. */
    VICTIM,
    /** The name of the player who just killed this bot. */
    KILLER,
    /** The name of this bot's team. */
    TEAM,
    /** The name of the bomb that was armed or defused. */
    BOMB;

    /** The text between the braces: {@code victim}, {@code killer}, ... */
    public String key() {
      return name().toLowerCase(Locale.ROOT);
    }
  }

  /** The moments a personality has lines for, with the placeholders each may use. */
  public enum Moment {
    GREET("greet"),
    ON_KILL("onKill"),
    ON_DEATH("onDeath"),
    ON_PLANT("onPlant"),
    ON_DEFUSE("onDefuse"),
    ON_WIN("onWin"),
    ON_LOSS("onLoss"),
    ON_LAST_ALIVE("onLastAlive"),
    TAUNT("taunt"),
    LOBBY("lobby");

    private final String key;

    Moment(String key) {
      this.key = key;
    }

    /** The YAML key of this moment's pool. */
    public String key() {
      return key;
    }

    /** The placeholders a line for this moment may use. */
    public Set<Placeholder> placeholders() {
      return switch (this) {
        case ON_KILL -> EnumSet.of(Placeholder.VICTIM, Placeholder.TEAM);
        case ON_DEATH -> EnumSet.of(Placeholder.KILLER, Placeholder.TEAM);
        case ON_PLANT, ON_DEFUSE -> EnumSet.of(Placeholder.BOMB, Placeholder.TEAM);
        case GREET, ON_WIN, ON_LOSS, ON_LAST_ALIVE, TAUNT, LOBBY -> EnumSet.of(Placeholder.TEAM);
      };
    }

    /** The fewest lines this moment's pool may hold. */
    public int minLines() {
      return this == LOBBY ? MIN_LOBBY_LINES : MIN_LINES;
    }

    /** The most lines this moment's pool may hold. */
    public int maxLines() {
      return this == LOBBY ? MAX_LOBBY_LINES : MAX_LINES;
    }
  }

  public Lines {
    greet = check(Moment.GREET, greet);
    onKill = check(Moment.ON_KILL, onKill);
    onDeath = check(Moment.ON_DEATH, onDeath);
    onPlant = check(Moment.ON_PLANT, onPlant);
    onDefuse = check(Moment.ON_DEFUSE, onDefuse);
    onWin = check(Moment.ON_WIN, onWin);
    onLoss = check(Moment.ON_LOSS, onLoss);
    onLastAlive = check(Moment.ON_LAST_ALIVE, onLastAlive);
    taunt = check(Moment.TAUNT, taunt);
    lobby = check(Moment.LOBBY, lobby);
  }

  /** The pool for {@code moment}. */
  public List<String> pool(Moment moment) {
    return switch (moment) {
      case GREET -> greet;
      case ON_KILL -> onKill;
      case ON_DEATH -> onDeath;
      case ON_PLANT -> onPlant;
      case ON_DEFUSE -> onDefuse;
      case ON_WIN -> onWin;
      case ON_LOSS -> onLoss;
      case ON_LAST_ALIVE -> onLastAlive;
      case TAUNT -> taunt;
      case LOBBY -> lobby;
    };
  }

  /** The placeholders {@code line} uses, or an error naming the first unknown or stray brace. */
  public static Set<Placeholder> placeholdersOf(String line) {
    var used = EnumSet.noneOf(Placeholder.class);
    var matcher = PLACEHOLDER.matcher(line);
    while (matcher.find()) {
      used.add(placeholder(matcher.group(1), line));
    }
    var rest = PLACEHOLDER.matcher(line).replaceAll("");
    if (rest.indexOf('{') >= 0 || rest.indexOf('}') >= 0) {
      throw new IllegalArgumentException("stray brace in line: '" + line + "'");
    }
    return used;
  }

  private static Placeholder placeholder(String key, String line) {
    for (var placeholder : Placeholder.values()) {
      if (placeholder.key().equals(key)) {
        return placeholder;
      }
    }
    throw new IllegalArgumentException("unknown placeholder {" + key + "} in: '" + line + "'");
  }

  private static List<String> check(Moment moment, List<String> pool) {
    var copy = List.copyOf(pool);
    if (copy.size() < moment.minLines() || copy.size() > moment.maxLines()) {
      throw new IllegalArgumentException(
          moment.key()
              + " needs "
              + moment.minLines()
              + ".."
              + moment.maxLines()
              + " lines, has "
              + copy.size()
              + ": "
              + copy);
    }
    if (Set.copyOf(copy).size() != copy.size()) {
      throw new IllegalArgumentException(moment.key() + " repeats a line: " + copy);
    }
    for (var line : copy) {
      if (line.isBlank() || !line.strip().equals(line) || line.length() > MAX_LINE_LENGTH) {
        throw new IllegalArgumentException(
            moment.key()
                + " lines must be 1..80 characters with no surrounding space: '"
                + line
                + "'");
      }
      for (var used : placeholdersOf(line)) {
        if (!moment.placeholders().contains(used)) {
          throw new IllegalArgumentException(
              moment.key() + " lines may not use {" + used.key() + "}: '" + line + "'");
        }
      }
    }
    return copy;
  }
}
