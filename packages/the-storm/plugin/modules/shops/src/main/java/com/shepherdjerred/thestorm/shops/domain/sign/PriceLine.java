package com.shepherdjerred.thestorm.shops.domain.sign;

import static java.util.Objects.requireNonNull;

import com.shepherdjerred.thestorm.core.result.Result;
import com.shepherdjerred.thestorm.shops.domain.price.Price;
import com.shepherdjerred.thestorm.shops.domain.price.ShopPrices;
import com.shepherdjerred.thestorm.shops.domain.trade.Direction;
import java.util.ArrayList;
import java.util.EnumMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Reads the price line: up to two parts separated by {@code :}, each {@code B <crystals>} (what a
 * customer pays to buy) or {@code S <crystals>} (what a customer is paid to sell). The letter may
 * come before or after the number, case and spaces do not matter, and thousands may be grouped with
 * commas: {@code B 50:S 40}, {@code 50b : 40s}, {@code S 1,000}.
 */
public final class PriceLine {

  private static final String AMOUNT = "(\\d{1,3}(?:,\\d{3})+|\\d+)";
  private static final Pattern PART =
      Pattern.compile("(?i)(?:([BS])\\s*" + AMOUNT + "|" + AMOUNT + "\\s*([BS]))");

  /** Loosely spots a price, to tell a shop sign from an ordinary sign that mentions a number. */
  private static final Pattern LOOKS_LIKE_PRICE =
      Pattern.compile("(?i)(?:\\b[BS]\\s*\\d|\\d\\s*[BS]\\b)");

  /** Longest amount parsed before calling it too high, so parsing never overflows. */
  private static final int MAX_DIGITS = 12;

  private PriceLine() {}

  /** Whether the line looks like a price line at all. */
  public static boolean looksLikePrices(String line) {
    return LOOKS_LIKE_PRICE.matcher(line).find();
  }

  public static Result<ShopPrices, List<SignProblem>> parse(String line) {
    var text = line.strip();
    if (text.isEmpty()) {
      return Result.err(List.of(new SignProblem.MissingPrices()));
    }
    var parts = text.split(":", -1);
    if (parts.length > 2) {
      return Result.err(List.of(new SignProblem.TooManyPrices(parts.length)));
    }
    var problems = new ArrayList<SignProblem>();
    var prices = new EnumMap<Direction, Price>(Direction.class);
    for (var part : parts) {
      parsePart(part.strip(), prices, problems);
    }
    if (!problems.isEmpty()) {
      return Result.err(List.copyOf(problems));
    }
    return ShopPrices.of(
            Optional.ofNullable(prices.get(Direction.BUY)),
            Optional.ofNullable(prices.get(Direction.SELL)))
        .mapError(errors -> errors.stream().<SignProblem>map(SignProblem.BadPrices::new).toList());
  }

  private static void parsePart(
      String part, Map<Direction, Price> prices, List<SignProblem> problems) {
    var matcher = PART.matcher(part);
    if (!matcher.matches()) {
      problems.add(new SignProblem.NotAPrice(part));
      return;
    }
    var side = side(matcher);
    var amount = amount(matcher).replace(",", "");
    if (prices.containsKey(side)) {
      problems.add(new SignProblem.SideTwice(side));
      return;
    }
    if (amount.length() > MAX_DIGITS || Long.parseLong(amount) > Price.MAX) {
      problems.add(new SignProblem.PriceTooHigh(side, Price.MAX));
      return;
    }
    var crystals = Long.parseLong(amount);
    if (crystals == 0) {
      problems.add(new SignProblem.ZeroPrice(side));
      return;
    }
    prices.put(side, Price.of(crystals));
  }

  private static Direction side(Matcher matcher) {
    var leading = matcher.group(1);
    var letter = leading != null ? leading : requireNonNull(matcher.group(4));
    return letter.toUpperCase(Locale.ROOT).equals("B") ? Direction.BUY : Direction.SELL;
  }

  private static String amount(Matcher matcher) {
    var leading = matcher.group(2);
    return leading != null ? leading : requireNonNull(matcher.group(3));
  }
}
