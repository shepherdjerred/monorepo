package com.shepherdjerred.thestorm.npcs.domain.schedule;

import com.shepherdjerred.thestorm.core.result.Result;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.regex.Pattern;

/**
 * What an NPC does during a schedule slot. Each names places by id ({@code home} is always the
 * NPC's own home); the NPC walks to them rather than teleporting.
 *
 * <p>Content writes an activity as one line: {@code stay <place>}, {@code wander <place> <radius>},
 * {@code patrol <place> <place>...} or {@code sleep <place>}.
 */
public sealed interface Activity {

  /** The largest wander radius, so wandering stays inside the chunks kept loaded for it. */
  int MAX_WANDER_RADIUS = 32;

  /** The most places one patrol visits. */
  int MAX_PATROL_STOPS = 16;

  /** Walk to {@code place} and stand there, facing its direction. */
  record Stay(String place) implements Activity {}

  /** Stroll between random points within {@code radius} blocks of {@code place}. */
  record Wander(String place, int radius) implements Activity {

    public Wander {
      if (radius < 1 || radius > MAX_WANDER_RADIUS) {
        throw new IllegalArgumentException(
            "wander radius must be 1.." + MAX_WANDER_RADIUS + ": " + radius);
      }
    }
  }

  /** Walk the {@code route} in order, then start over. */
  record Patrol(List<String> route) implements Activity {

    public Patrol {
      route = List.copyOf(route);
      if (route.size() < 2 || route.size() > MAX_PATROL_STOPS) {
        throw new IllegalArgumentException(
            "a patrol visits 2.." + MAX_PATROL_STOPS + " places: " + route);
      }
    }
  }

  /** Walk to the bed at {@code place} and lie down. */
  record Sleep(String place) implements Activity {}

  /** Every place this activity names. */
  default List<String> places() {
    return switch (this) {
      case Stay(var place) -> List.of(place);
      case Wander(var place, var _) -> List.of(place);
      case Patrol(var route) -> route;
      case Sleep(var place) -> List.of(place);
    };
  }

  /** Parses one activity line. */
  static Result<Activity, String> parse(String line) {
    return Parser.parse(line);
  }

  /** The activity line syntax. */
  final class Parser {

    private static final Pattern ID = Pattern.compile("[a-z0-9][a-z0-9_-]*");
    private static final Pattern NUMBER = Pattern.compile("\\d{1,3}");

    private Parser() {}

    static Result<Activity, String> parse(String line) {
      var words = Arrays.asList(line.trim().split("\\s+"));
      var verb = words.getFirst();
      var arguments = words.subList(1, words.size());
      return switch (verb) {
        case "stay" -> one(arguments, line).map(Stay::new);
        case "sleep" -> one(arguments, line).map(Sleep::new);
        case "wander" -> wander(arguments, line);
        case "patrol" -> patrol(arguments, line);
        default ->
            Result.err(
                "unknown activity \""
                    + verb
                    + "\"; write stay <place>, wander <place> <radius>, patrol <place> <place>..."
                    + " or sleep <place>");
      };
    }

    private static Result<String, String> one(List<String> arguments, String line) {
      if (arguments.size() != 1) {
        return Result.err("expected exactly one place: " + line);
      }
      return place(arguments.getFirst());
    }

    private static Result<String, String> place(String word) {
      return ID.matcher(word).matches()
          ? Result.ok(word)
          : Result.err("not a place id (lowercase letters, digits, - and _): " + word);
    }

    private static Result<Activity, String> wander(List<String> arguments, String line) {
      if (arguments.size() != 2
          || !ID.matcher(arguments.get(0)).matches()
          || !NUMBER.matcher(arguments.get(1)).matches()) {
        return Result.err("expected wander <place> <radius>: " + line);
      }
      var radius = Integer.parseInt(arguments.get(1));
      if (radius < 1 || radius > MAX_WANDER_RADIUS) {
        return Result.err("wander radius must be 1.." + MAX_WANDER_RADIUS + ": " + line);
      }
      return Result.ok(new Wander(arguments.get(0), radius));
    }

    private static Result<Activity, String> patrol(List<String> arguments, String line) {
      if (arguments.size() < 2 || arguments.size() > MAX_PATROL_STOPS) {
        return Result.err("a patrol visits 2.." + MAX_PATROL_STOPS + " places: " + line);
      }
      var route = new ArrayList<String>();
      for (var word : arguments) {
        switch (place(word)) {
          case Result.Ok<String, String>(var id) -> route.add(id);
          case Result.Err<String, String>(var problem) -> {
            return Result.err(problem);
          }
        }
      }
      return Result.ok(new Patrol(route));
    }
  }
}
