package com.shepherdjerred.thestorm.essentials.domain.place;

import com.shepherdjerred.thestorm.core.result.Result;
import java.time.Duration;
import java.util.Locale;
import java.util.regex.Pattern;

/**
 * Durations as players type and read them: {@code 30s}, {@code 15m}, {@code 2h30m}, {@code 7d},
 * {@code 2w}.
 */
public final class DurationText {

  private static final Pattern PART = Pattern.compile("(\\d{1,6})([smhdw])");
  private static final Pattern WHOLE = Pattern.compile("(\\d{1,6}[smhdw])+");

  private DurationText() {}

  /** Parses a positive duration such as {@code 1d12h}. */
  public static Result<Duration, String> parse(String input) {
    var text = input.strip().toLowerCase(Locale.ROOT);
    if (!WHOLE.matcher(text).matches()) {
      return Result.err("'" + input + "' is not a duration; use for example 30m, 12h, 7d or 1d12h");
    }
    var total = Duration.ZERO;
    var matcher = PART.matcher(text);
    while (matcher.find()) {
      var amount = Long.parseLong(matcher.group(1));
      total = total.plus(unit(matcher.group(2).charAt(0)).multipliedBy(amount));
    }
    if (total.isZero()) {
      return Result.err("A duration must be longer than zero");
    }
    return Result.ok(total);
  }

  /**
   * Formats a duration for players, largest units first, rounding any fraction of a second up: for
   * example {@code 1d 2h 3m 4s}. Zero or negative durations read {@code 0s}.
   */
  public static String format(Duration duration) {
    if (duration.isNegative() || duration.isZero()) {
      return "0s";
    }
    var seconds = duration.getSeconds() + (duration.getNano() > 0 ? 1 : 0);
    var days = seconds / 86_400;
    var hours = seconds % 86_400 / 3_600;
    var minutes = seconds % 3_600 / 60;
    var rest = seconds % 60;
    var out = new StringBuilder();
    append(out, days, "d");
    append(out, hours, "h");
    append(out, minutes, "m");
    append(out, rest, "s");
    return out.toString();
  }

  private static void append(StringBuilder out, long amount, String unit) {
    if (amount == 0) {
      return;
    }
    if (!out.isEmpty()) {
      out.append(' ');
    }
    out.append(amount).append(unit);
  }

  private static Duration unit(char unit) {
    return switch (unit) {
      case 's' -> Duration.ofSeconds(1);
      case 'm' -> Duration.ofMinutes(1);
      case 'h' -> Duration.ofHours(1);
      case 'd' -> Duration.ofDays(1);
      case 'w' -> Duration.ofDays(7);
      default -> throw new IllegalArgumentException("unknown duration unit " + unit);
    };
  }
}
