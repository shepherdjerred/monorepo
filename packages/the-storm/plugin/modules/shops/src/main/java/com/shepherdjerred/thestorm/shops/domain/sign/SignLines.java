package com.shepherdjerred.thestorm.shops.domain.sign;

import java.util.List;

/**
 * The four plain-text lines of a sign's front, top to bottom.
 *
 * @param lines exactly four lines
 */
public record SignLines(List<String> lines) {

  public static final int OWNER = 0;
  public static final int QUANTITY = 1;
  public static final int PRICES = 2;
  public static final int ITEM = 3;

  public SignLines {
    lines = List.copyOf(lines);
    if (lines.size() != 4) {
      throw new IllegalArgumentException("a sign has four lines, not " + lines.size());
    }
  }

  public static SignLines of(String owner, String quantity, String prices, String item) {
    return new SignLines(List.of(owner, quantity, prices, item));
  }

  public String owner() {
    return lines.get(OWNER);
  }

  public String quantity() {
    return lines.get(QUANTITY);
  }

  public String prices() {
    return lines.get(PRICES);
  }

  public String item() {
    return lines.get(ITEM);
  }
}
