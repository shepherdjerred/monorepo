package com.shepherdjerred.thestorm.shops.domain.price;

import java.util.List;
import java.util.Optional;

/** Every price rule, applied together; problems are collected rather than thrown. */
public final class PriceRules {

  private static final PriceRules STANDARD =
      new PriceRules(List.of(new SomethingOfferedRule(), new SellNotAboveBuyRule()));

  private final List<PriceRule> rules;

  public PriceRules(List<PriceRule> rules) {
    this.rules = List.copyOf(rules);
  }

  /** The rules every sign and catalog entry follows. */
  public static PriceRules standard() {
    return STANDARD;
  }

  /** Every problem with these prices; empty when they are valid. */
  public List<PriceProblem> check(Optional<Price> buy, Optional<Price> sell) {
    return rules.stream().flatMap(rule -> rule.check(buy, sell).stream()).toList();
  }
}
