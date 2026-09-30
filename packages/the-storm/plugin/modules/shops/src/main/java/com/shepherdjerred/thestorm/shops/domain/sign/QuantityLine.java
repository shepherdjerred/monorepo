package com.shepherdjerred.thestorm.shops.domain.sign;

import com.shepherdjerred.thestorm.core.result.Result;
import java.util.regex.Pattern;

/** Reads the quantity line: a whole number of items per trade, from 1 to a configured maximum. */
public final class QuantityLine {

  private static final Pattern DIGITS = Pattern.compile("\\d+");
  private static final int MAX_DIGITS = 9;

  private QuantityLine() {}

  public static Result<Integer, SignProblem> parse(String line, int maxQuantity) {
    var text = line.strip();
    if (text.isEmpty()) {
      return Result.err(new SignProblem.MissingQuantity());
    }
    if (!DIGITS.matcher(text).matches()) {
      return Result.err(new SignProblem.NotAQuantity(text));
    }
    if (text.length() > MAX_DIGITS) {
      return Result.err(new SignProblem.QuantityOutOfRange(text, maxQuantity));
    }
    var quantity = Integer.parseInt(text);
    return quantity < 1 || quantity > maxQuantity
        ? Result.err(new SignProblem.QuantityOutOfRange(text, maxQuantity))
        : Result.ok(quantity);
  }
}
