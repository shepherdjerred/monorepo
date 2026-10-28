package com.shepherdjerred.thestorm.shops.domain.price;

/**
 * A shop tax taken from a trade's listed price. The payer still pays the whole price. The payee
 * receives what is left, and the rest is the server's tax. A tax of the whole price leaves the
 * payee nothing.
 *
 * @param gross the listed price, what the payer pays
 * @param tax crystals kept by the server
 */
public record ShopLevy(long gross, long tax) {

  public ShopLevy {
    if (gross < 1) {
      throw new IllegalArgumentException("a taxed price must be at least 1 crystal: " + gross);
    }
    if (tax < 0 || tax > gross) {
      throw new IllegalArgumentException("tax must be 0.." + gross + ", not " + tax);
    }
  }

  /** What the payee receives. */
  public long net() {
    return gross - tax;
  }

  /**
   * Tax of {@code percent} percent of {@code gross}, rounded down. {@code percent} is 0..100. A
   * trade of one crystal is never split, so a positive percent of 1 is still no tax.
   */
  public static ShopLevy of(long gross, int percent) {
    if (percent < 0 || percent > 100) {
      throw new IllegalArgumentException("tax percent must be 0..100: " + percent);
    }
    var tax = Math.multiplyExact(gross, percent) / 100;
    return new ShopLevy(gross, tax);
  }
}
