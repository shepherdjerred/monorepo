package com.shepherdjerred.thestorm.mechanics.domain.tools;

import com.shepherdjerred.thestorm.core.result.Result;
import java.util.List;
import java.util.regex.Pattern;
import java.util.stream.IntStream;

/**
 * The map ids a {@code [Map]} sign cycles through, written on its third line as {@code first-last},
 * for example {@code 12-15}.
 *
 * @param first the lowest id
 * @param last the highest id
 */
public record MapRange(int first, int last) {

  /** The line of a {@code [Map]} sign that holds the range. */
  public static final int LINE = 2;

  private static final Pattern RANGE = Pattern.compile("\\s*(\\d{1,9})\\s*-\\s*(\\d{1,9})\\s*");

  public MapRange {
    if (first < 0 || last <= first) {
      throw new IllegalArgumentException("a map range runs upward from 0: " + first + "-" + last);
    }
  }

  /** Reads {@code line}, allowing at most {@code maxRange} ids. */
  public static Result<MapRange, String> parse(String line, int maxRange) {
    var match = RANGE.matcher(line);
    if (!match.matches()) {
      return Result.err("Write the map ids on the third line as first-last, like 12-15.");
    }
    var first = Integer.parseInt(match.group(1));
    var last = Integer.parseInt(match.group(2));
    if (last <= first) {
      return Result.err("The second map id must be higher than the first.");
    }
    if ((long) last - first + 1 > maxRange) {
      return Result.err("A map changer cycles at most " + maxRange + " maps.");
    }
    return Result.ok(new MapRange(first, last));
  }

  public List<Integer> ids() {
    return IntStream.rangeClosed(first, last).boxed().toList();
  }
}
