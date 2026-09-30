package com.shepherdjerred.thestorm.quests.domain.content;

import com.shepherdjerred.thestorm.core.result.Result;
import com.shepherdjerred.thestorm.quests.domain.model.Action;
import com.shepherdjerred.thestorm.quests.domain.model.Condition;
import com.shepherdjerred.thestorm.quests.domain.model.Condition.Comparison;
import com.shepherdjerred.thestorm.quests.domain.model.Condition.Weather;
import com.shepherdjerred.thestorm.quests.domain.model.ItemMatch;
import com.shepherdjerred.thestorm.quests.domain.model.Objective;
import com.shepherdjerred.thestorm.quests.domain.model.Stage;
import java.time.Duration;
import java.util.Arrays;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.TreeMap;
import java.util.regex.Pattern;

/**
 * The one-line languages quest content uses for objectives, conditions, actions, items and time
 * limits. Parsing only checks the shape; references (NPCs, regions, materials...) are checked by
 * {@link ContentCheck}.
 *
 * <pre>
 * objectives (append " | text" to replace the generated description):
 *   talk NPC                  deliver NPC N ITEM          hold N ITEM
 *   collect N ITEM            craft N ITEM                fish N ITEM|any
 *   mine N BLOCK              place N BLOCK               kill N ENTITY
 *   reach REGION              level TRACK N               custom HOOK N
 * conditions (prefix "not " to negate):
 *   has N ITEM                track TRACK N               completed QUEST
 *   active QUEST              reputation FACTION N        points N
 *   time HH:MM-HH:MM          weather clear|rain|thunder  region REGION
 *   permission NODE           var NAME OP N  (OP is == != &lt; &lt;= &gt; &gt;=)
 * actions:
 *   give N ITEM               take N ITEM                 crystals N
 *   permission NODE           title ID                    spell ID
 *   set VAR N                 add VAR N                   flag VAR
 *   reputation FACTION N      points N                    start QUEST
 *   message TEXT              teleport REGION             spawn N ENTITY REGION [NAME]
 *   marker NPC available|turn-in|none                     custom HOOK ARGUMENT
 * items: MATERIAL, optionally MATERIAL[enchant=KEY:LEVEL,name=TEXT,potion=KEY]
 * time limits: none, or DURATION TARGET such as "30m fail" or "2h ambush" (units s, m, h, d)
 * </pre>
 */
public final class Dsl {

  private static final Pattern NUMBER = Pattern.compile("-?[0-9]+");
  private static final Pattern TIME = Pattern.compile("([0-2][0-9]):([0-5][0-9])");
  private static final Pattern DURATION = Pattern.compile("([1-9][0-9]*)([smhd])");
  private static final String LABEL_SEPARATOR = " | ";

  private Dsl() {}

  // ---- objectives ----------------------------------------------------------------------------

  /** Parses an objective line. */
  public static Result<Objective, String> objective(String line) {
    var split = line.indexOf(LABEL_SEPARATOR);
    var body = split < 0 ? line.strip() : line.substring(0, split).strip();
    var label =
        split < 0
            ? Optional.<String>empty()
            : Optional.of(line.substring(split + LABEL_SEPARATOR.length()).strip());
    if (label.isPresent() && label.get().isEmpty()) {
      return Result.err("an objective's text after | must not be empty");
    }
    var words = body.split(" ", 4);
    try {
      return Result.ok(objective(words, label));
    } catch (IllegalArgumentException e) {
      return Result.err("objective \"" + line + "\": " + e.getMessage());
    }
  }

  private static Objective objective(String[] words, Optional<String> label) {
    return switch (words[0]) {
      case "talk" -> new Objective.Talk(arg(words, 1, 2), label);
      case "deliver" -> {
        var rest = rest(words, 3);
        yield new Objective.Deliver(
            arg(words, 1, 4), parseItem(rest), count(arg(words, 2, 4)), label);
      }
      case "hold" -> new Objective.Hold(parseItem(rest(words, 2)), count(arg(words, 1, 4)), label);
      case "collect" ->
          new Objective.Collect(parseItem(rest(words, 2)), count(arg(words, 1, 4)), label);
      case "craft" ->
          new Objective.Craft(parseItem(rest(words, 2)), count(arg(words, 1, 4)), label);
      case "fish" -> {
        var what = rest(words, 2);
        var item = "any".equals(what) ? Optional.<ItemMatch>empty() : Optional.of(parseItem(what));
        yield new Objective.Fish(item, count(arg(words, 1, 4)), label);
      }
      case "mine" -> new Objective.Mine(upper(arg(words, 2, 3)), count(arg(words, 1, 3)), label);
      case "place" -> new Objective.Place(upper(arg(words, 2, 3)), count(arg(words, 1, 3)), label);
      case "kill" -> new Objective.Kill(upper(arg(words, 2, 3)), count(arg(words, 1, 3)), label);
      case "reach" -> new Objective.Reach(arg(words, 1, 2), label);
      case "level" -> new Objective.Level(arg(words, 1, 3), count(arg(words, 2, 3)), label);
      case "custom" -> new Objective.Custom(arg(words, 1, 3), count(arg(words, 2, 3)), label);
      default -> throw new IllegalArgumentException("unknown objective " + words[0]);
    };
  }

  // ---- conditions ----------------------------------------------------------------------------

  /** Parses a condition line. */
  public static Result<Condition, String> condition(String line) {
    var body = line.strip();
    try {
      if (body.startsWith("not ")) {
        return Result.ok(new Condition.Not(condition(body.substring(4).strip().split(" ", 4))));
      }
      return Result.ok(condition(body.split(" ", 4)));
    } catch (IllegalArgumentException e) {
      return Result.err("condition \"" + line + "\": " + e.getMessage());
    }
  }

  private static Condition condition(String[] words) {
    return switch (words[0]) {
      case "has" -> new Condition.HasItem(parseItem(rest(words, 2)), count(arg(words, 1, 4)));
      case "track" -> new Condition.TrackAtLeast(arg(words, 1, 3), count(arg(words, 2, 3)));
      case "completed" -> new Condition.Completed(arg(words, 1, 2));
      case "active" -> new Condition.Active(arg(words, 1, 2));
      case "reputation" ->
          new Condition.ReputationAtLeast(arg(words, 1, 3), number(arg(words, 2, 3)));
      case "points" -> new Condition.PointsAtLeast(number(arg(words, 1, 2)));
      case "time" -> time(arg(words, 1, 2));
      case "weather" -> new Condition.WeatherIs(weather(arg(words, 1, 2)));
      case "region" -> new Condition.InRegion(arg(words, 1, 2));
      case "permission" -> new Condition.HasPermission(arg(words, 1, 2));
      case "var" ->
          new Condition.Compare(
              arg(words, 1, 4), comparison(arg(words, 2, 4)), number(arg(words, 3, 4)));
      default -> throw new IllegalArgumentException("unknown condition " + words[0]);
    };
  }

  private static Condition time(String range) {
    var ends = range.split("-", -1);
    if (ends.length != 2) {
      throw new IllegalArgumentException("a time range is HH:MM-HH:MM");
    }
    return new Condition.TimeBetween(minute(ends[0]), minute(ends[1]));
  }

  /** Minutes after midnight for {@code HH:MM}. */
  static int minute(String time) {
    var matcher = TIME.matcher(time);
    if (!matcher.matches()) {
      throw new IllegalArgumentException("times are HH:MM: " + time);
    }
    var hours = Integer.parseInt(matcher.group(1));
    if (hours > 23) {
      throw new IllegalArgumentException("hours are 00..23: " + time);
    }
    return hours * 60 + Integer.parseInt(matcher.group(2));
  }

  private static Weather weather(String word) {
    return switch (word) {
      case "clear" -> Weather.CLEAR;
      case "rain" -> Weather.RAIN;
      case "thunder", "storm" -> Weather.THUNDER;
      default -> throw new IllegalArgumentException("weather is clear, rain or thunder");
    };
  }

  private static Comparison comparison(String symbol) {
    return Arrays.stream(Comparison.values())
        .filter(candidate -> candidate.symbol().equals(symbol))
        .findFirst()
        .orElseThrow(() -> new IllegalArgumentException("unknown comparison " + symbol));
  }

  // ---- actions -------------------------------------------------------------------------------

  /** Parses an action line. */
  public static Result<Action, String> action(String line) {
    var body = line.strip();
    var words = body.split(" ", 5);
    try {
      return Result.ok(action(words, body));
    } catch (IllegalArgumentException e) {
      return Result.err("action \"" + line + "\": " + e.getMessage());
    }
  }

  private static Action action(String[] words, String body) {
    return switch (words[0]) {
      case "give" -> new Action.Give(parseItem(tail(body, 2)), count(arg(words, 1, 5)));
      case "take" -> new Action.Take(parseItem(tail(body, 2)), count(arg(words, 1, 5)));
      case "crystals" -> new Action.Crystals(number(arg(words, 1, 2)));
      case "permission" -> new Action.Grant(arg(words, 1, 2));
      case "title" -> new Action.Title(arg(words, 1, 2));
      case "spell" -> new Action.Spell(arg(words, 1, 2));
      case "set" -> new Action.SetVariable(arg(words, 1, 3), number(arg(words, 2, 3)));
      case "add" -> new Action.AddVariable(arg(words, 1, 3), number(arg(words, 2, 3)));
      case "flag" -> new Action.SetVariable(arg(words, 1, 2), 1);
      case "reputation" -> new Action.Reputation(arg(words, 1, 3), number(arg(words, 2, 3)));
      case "points" -> new Action.Points(positive(number(arg(words, 1, 2))));
      case "start" -> new Action.StartQuest(arg(words, 1, 2));
      case "message" -> new Action.Message(nonBlank(tail(body, 1)));
      case "teleport" -> new Action.Teleport(arg(words, 1, 2));
      case "spawn" -> spawn(words, body);
      case "marker" -> new Action.Marker(arg(words, 1, 3), mark(arg(words, 2, 3)));
      case "custom" -> new Action.Custom(arg(words, 1, 5), nonBlank(tail(body, 2)));
      default -> throw new IllegalArgumentException("unknown action " + words[0]);
    };
  }

  private static Action spawn(String[] words, String body) {
    var name = words.length == 5 ? Optional.of(nonBlank(tail(body, 4))) : Optional.<String>empty();
    return new Action.Spawn(
        upper(arg(words, 2, 5)), count(arg(words, 1, 5)), arg(words, 3, 5), name);
  }

  private static Action.NpcMark mark(String word) {
    return switch (word) {
      case "available" -> Action.NpcMark.AVAILABLE;
      case "turn-in" -> Action.NpcMark.TURN_IN;
      case "none" -> Action.NpcMark.NONE;
      default -> throw new IllegalArgumentException("markers are available, turn-in or none");
    };
  }

  // ---- items and time limits -----------------------------------------------------------------

  /** Parses an item: {@code MATERIAL} or {@code MATERIAL[key=value,...]}. */
  public static Result<ItemMatch, String> item(String text) {
    try {
      return Result.ok(parseItem(text));
    } catch (IllegalArgumentException e) {
      return Result.err("item \"" + text + "\": " + e.getMessage());
    }
  }

  private static ItemMatch parseItem(String text) {
    var open = text.indexOf('[');
    if (open < 0) {
      return ItemMatch.of(text.strip());
    }
    if (!text.endsWith("]")) {
      throw new IllegalArgumentException("item components end with ]");
    }
    var material = text.substring(0, open).strip();
    var name = Optional.<String>empty();
    var potion = Optional.<String>empty();
    var enchantments = new TreeMap<String, Integer>();
    for (var part : text.substring(open + 1, text.length() - 1).split(",", -1)) {
      var pair = part.split("=", 2);
      if (pair.length != 2) {
        throw new IllegalArgumentException("item components are key=value: " + part);
      }
      var value = pair[1].strip();
      switch (pair[0].strip()) {
        case "name" -> name = Optional.of(value);
        case "potion" -> potion = Optional.of(value);
        case "enchant" -> enchant(enchantments, value);
        default -> throw new IllegalArgumentException("unknown item component " + pair[0]);
      }
    }
    return new ItemMatch(material, name, Map.copyOf(enchantments), potion);
  }

  private static void enchant(Map<String, Integer> enchantments, String value) {
    var pair = value.split(":", 2);
    if (pair.length != 2) {
      throw new IllegalArgumentException("enchant is key:level: " + value);
    }
    if (enchantments.put(pair[0], count(pair[1])) != null) {
      throw new IllegalArgumentException("enchantment " + pair[0] + " listed twice");
    }
  }

  /** Parses a stage time limit: {@code none} or a duration and a target. */
  public static Result<Optional<Stage.TimeLimit>, String> timeLimit(String text) {
    if ("none".equals(text)) {
      return Result.ok(Optional.empty());
    }
    var words = text.strip().split(" ", -1);
    var matcher = words.length == 2 ? DURATION.matcher(words[0]) : null;
    if (matcher == null || !matcher.matches()) {
      return Result.err("time limits are none or DURATION TARGET, such as \"30m fail\"");
    }
    var amount = Long.parseLong(matcher.group(1));
    var duration =
        switch (matcher.group(2)) {
          case "s" -> Duration.ofSeconds(amount);
          case "m" -> Duration.ofMinutes(amount);
          case "h" -> Duration.ofHours(amount);
          default -> Duration.ofDays(amount);
        };
    return Result.ok(Optional.of(new Stage.TimeLimit(duration, words[1])));
  }

  // ---- words ---------------------------------------------------------------------------------

  /** Word {@code index} of a phrase that has exactly {@code size} words. */
  private static String arg(String[] words, int index, int size) {
    if (index >= words.length || words.length > size) {
      throw new IllegalArgumentException(
          "expected " + (size - 1) + " argument" + (size == 2 ? "" : "s"));
    }
    if (words[index].isBlank()) {
      throw new IllegalArgumentException("empty argument");
    }
    return words[index];
  }

  /** Everything from word {@code index} on (the phrase was split with a limit). */
  private static String rest(String[] words, int index) {
    if (index >= words.length) {
      throw new IllegalArgumentException("missing an item");
    }
    return String.join(" ", Arrays.copyOfRange(words, index, words.length)).strip();
  }

  /** Everything after the first {@code skip} words of {@code body}. */
  private static String tail(String body, int skip) {
    var rest = body;
    for (var index = 0; index < skip; index++) {
      var space = rest.indexOf(' ');
      if (space < 0) {
        throw new IllegalArgumentException("missing arguments");
      }
      rest = rest.substring(space + 1).strip();
    }
    return rest;
  }

  private static String upper(String word) {
    return word.toUpperCase(Locale.ROOT);
  }

  private static int count(String word) {
    var value = number(word);
    if (value < 1 || value > Integer.MAX_VALUE) {
      throw new IllegalArgumentException("counts are positive whole numbers: " + word);
    }
    return (int) value;
  }

  private static long positive(long value) {
    if (value < 1) {
      throw new IllegalArgumentException("must be positive: " + value);
    }
    return value;
  }

  private static long number(String word) {
    if (!NUMBER.matcher(word).matches()) {
      throw new IllegalArgumentException("not a whole number: " + word);
    }
    try {
      return Long.parseLong(word);
    } catch (NumberFormatException e) {
      throw new IllegalArgumentException("number out of range: " + word, e);
    }
  }

  private static String nonBlank(String text) {
    if (text.isBlank()) {
      throw new IllegalArgumentException("text must not be empty");
    }
    return text;
  }
}
