package com.shepherdjerred.thestorm.chat.domain;

import com.shepherdjerred.thestorm.core.result.Result;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.regex.Pattern;

/** Parses and prints the short durations staff type, such as {@code 30m} or {@code 1d12h}. */
public final class Durations {

  private static final Pattern FORMAT = Pattern.compile("(?:\\d+[dhms])+");
  private static final Pattern PART = Pattern.compile("(\\d+)([dhms])");
  private static final int MAX_PART_DIGITS = 6;

  private Durations() {}

  /** Parses {@code 1d2h3m4s}-style input; every unit is optional but at least one is needed. */
  public static Result<Duration, String> parse(String input) {
    var text = input.strip().toLowerCase(Locale.ROOT);
    if (!FORMAT.matcher(text).matches()) {
      return Result.err("'" + input + "' is not a duration; use e.g. 30m, 2h or 1d12h");
    }
    var total = Duration.ZERO;
    var matcher = PART.matcher(text);
    while (matcher.find()) {
      if (matcher.group(1).length() > MAX_PART_DIGITS) {
        return Result.err("'" + input + "' is too long");
      }
      var amount = Long.parseLong(matcher.group(1));
      total =
          total.plus(
              switch (matcher.group(2)) {
                case "d" -> Duration.ofDays(amount);
                case "h" -> Duration.ofHours(amount);
                case "m" -> Duration.ofMinutes(amount);
                case "s" -> Duration.ofSeconds(amount);
                default -> throw new IllegalStateException("unmatched unit " + matcher.group(2));
              });
    }
    if (total.isZero()) {
      return Result.err("a duration must be longer than zero");
    }
    return Result.ok(total);
  }

  /**
   * Prints {@code duration} as {@code 1d 2h 3m 4s}, leaving out zero units. Partial seconds round
   * up, so a mute with 0.2s left reads {@code 1s}, never {@code 0s}.
   */
  public static String format(Duration duration) {
    var seconds = duration.toSeconds() + (duration.toNanosPart() > 0 ? 1 : 0);
    if (seconds <= 0) {
      return "0s";
    }
    var parts = new ArrayList<String>();
    append(parts, seconds / 86_400, "d");
    append(parts, seconds % 86_400 / 3600, "h");
    append(parts, seconds % 3600 / 60, "m");
    append(parts, seconds % 60, "s");
    return String.join(" ", parts);
  }

  private static void append(List<String> parts, long amount, String unit) {
    if (amount > 0) {
      parts.add(amount + unit);
    }
  }
}
