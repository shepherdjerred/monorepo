package com.shepherdjerred.thestorm.shops.domain.sign;

import com.shepherdjerred.thestorm.shops.domain.price.PriceProblem;
import com.shepherdjerred.thestorm.shops.domain.trade.Direction;

/** Why the lines on a shop sign cannot make a shop. */
public sealed interface SignProblem {

  /** The quantity line is empty. */
  record MissingQuantity() implements SignProblem {}

  /** The quantity line is not a whole number. */
  record NotAQuantity(String text) implements SignProblem {}

  /** The quantity is zero or larger than one trade may move. */
  record QuantityOutOfRange(String text, int max) implements SignProblem {}

  /** The price line is empty. */
  record MissingPrices() implements SignProblem {}

  /** Part of the price line is not {@code B <crystals>} or {@code S <crystals>}. */
  record NotAPrice(String text) implements SignProblem {}

  /** A price of zero; shops trade for at least one crystal. */
  record ZeroPrice(Direction side) implements SignProblem {}

  /** A price above the most a shop may ask. */
  record PriceTooHigh(Direction side, long max) implements SignProblem {}

  /** The same side appears twice, as in {@code B 5:B 6}. */
  record SideTwice(Direction side) implements SignProblem {}

  /** More than two prices separated by {@code :}. */
  record TooManyPrices(int count) implements SignProblem {}

  /** The prices break a price rule, such as selling above the buy price. */
  record BadPrices(PriceProblem problem) implements SignProblem {}

  /** The item line is empty. */
  record MissingItem() implements SignProblem {}

  /** No item has this name. */
  record UnknownItem(String text) implements SignProblem {}

  /** A sentence for the player who wrote the sign. */
  default String describe() {
    return switch (this) {
      case MissingQuantity() -> "Line 2 needs the quantity per trade, like 16.";
      case NotAQuantity(var text) -> "Line 2 must be a whole number, not \"" + text + "\".";
      case QuantityOutOfRange(var text, var max) ->
          "Line 2 must be between 1 and " + max + ", not " + text + ".";
      case MissingPrices() -> "Line 3 needs prices, like B 50:S 40.";
      case NotAPrice(var text) ->
          "\"" + text + "\" is not a price; write B 50 to sell to players, S 40 to buy from them.";
      case ZeroPrice(var side) -> sideName(side) + " price must be at least 1 crystal.";
      case PriceTooHigh(var side, var max) ->
          sideName(side) + " price must be at most " + max + " crystals.";
      case SideTwice(var side) -> "Line 3 has two " + side.id() + " prices.";
      case TooManyPrices(var count) ->
          "Line 3 has " + count + " prices; write at most one B and one S.";
      case BadPrices(var problem) -> capitalize(problem.describe()) + ".";
      case MissingItem() -> "Line 4 needs an item name, or ? to set it by clicking.";
      case UnknownItem(var text) -> "There is no item called \"" + text + "\".";
    };
  }

  private static String sideName(Direction side) {
    return switch (side) {
      case BUY -> "The buy";
      case SELL -> "The sell";
    };
  }

  private static String capitalize(String text) {
    return text.isEmpty() ? text : Character.toUpperCase(text.charAt(0)) + text.substring(1);
  }
}
