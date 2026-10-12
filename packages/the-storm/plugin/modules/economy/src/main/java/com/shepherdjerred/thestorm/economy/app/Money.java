package com.shepherdjerred.thestorm.economy.app;

/**
 * An amount of one currency. Whole units only; never negative. Amounts of different currencies
 * never add up or compare: mixing them is a broken contract and throws.
 *
 * @param currency which currency
 * @param amount how many units
 */
public record Money(CurrencyId currency, long amount) {

  public Money {
    if (amount < 0) {
      throw new IllegalArgumentException(currency.key() + " must not be negative: " + amount);
    }
  }

  public static Money of(CurrencyId currency, long amount) {
    return new Money(currency, amount);
  }

  /** Crystals (CR), The Storm's survival currency. */
  public static Money crystals(long amount) {
    return new Money(CurrencyId.CRYSTALS, amount);
  }

  /** Red Warfare credits (RC). */
  public static Money rwfCredits(long amount) {
    return new Money(CurrencyId.RWF_CREDITS, amount);
  }

  public static Money zero(CurrencyId currency) {
    return new Money(currency, 0);
  }

  public boolean isZero() {
    return amount == 0;
  }

  public Money plus(Money other) {
    return new Money(currency, Math.addExact(amount, same(other).amount));
  }

  /** This amount less {@code other}; throws when that would be negative. */
  public Money minus(Money other) {
    return new Money(currency, Math.subtractExact(amount, same(other).amount));
  }

  public boolean isAtLeast(Money other) {
    return amount >= same(other).amount;
  }

  private Money same(Money other) {
    if (other.currency != currency) {
      throw new IllegalArgumentException(
          "cannot combine " + currency.key() + " with " + other.currency.key());
    }
    return other;
  }
}
