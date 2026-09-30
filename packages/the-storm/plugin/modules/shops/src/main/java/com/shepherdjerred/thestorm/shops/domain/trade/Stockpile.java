package com.shepherdjerred.thestorm.shops.domain.trade;

/**
 * How many of a shop's item one side of a trade holds, and how many more it could take.
 *
 * @param count matching items held
 * @param space more matching items that would fit
 */
public record Stockpile(int count, int space) {

  /** A side with endless stock and room: the server's admin and catalog shops. */
  public static final Stockpile UNLIMITED = new Stockpile(Integer.MAX_VALUE, Integer.MAX_VALUE);

  public Stockpile {
    if (count < 0 || space < 0) {
      throw new IllegalArgumentException("count and space must not be negative");
    }
  }
}
