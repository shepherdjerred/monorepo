package com.shepherdjerred.thestorm.shops.domain.shop;

import com.shepherdjerred.thestorm.shops.domain.sign.OwnerLine;
import java.util.List;
import java.util.Optional;

/** The rules for making a shop sign, applied together; every broken rule is reported. */
public final class CreationRules {

  private final List<CreationRule> rules;

  public CreationRules(List<CreationRule> rules) {
    this.rules = List.copyOf(rules);
  }

  /** The rules every shop sign follows, with the configured per-level limits. */
  public static CreationRules standard(ShopLimits limits) {
    return new CreationRules(
        List.of(
            CreationRules::adminShopsNeedAdmin,
            CreationRules::chestShopsNeedShopkeeper,
            attempt -> withinLimit(limits, attempt),
            CreationRules::chestShopsNeedAContainer,
            CreationRules::containerIsNotSomeoneElses));
  }

  public List<CreationProblem> check(CreationAttempt attempt) {
    return rules.stream().flatMap(rule -> rule.check(attempt).stream()).toList();
  }

  static Optional<CreationProblem> adminShopsNeedAdmin(CreationAttempt attempt) {
    return attempt.owner() instanceof OwnerLine.AdminShop && !attempt.admin()
        ? Optional.of(new CreationProblem.NotAdmin())
        : Optional.empty();
  }

  static Optional<CreationProblem> chestShopsNeedShopkeeper(CreationAttempt attempt) {
    return attempt.owner() instanceof OwnerLine.Creator && attempt.shopkeeperLevel() < 1
        ? Optional.of(new CreationProblem.NotShopkeeper())
        : Optional.empty();
  }

  static Optional<CreationProblem> withinLimit(ShopLimits limits, CreationAttempt attempt) {
    if (!(attempt.owner() instanceof OwnerLine.Creator) || attempt.shopkeeperLevel() < 1) {
      return Optional.empty();
    }
    var limit = limits.allowed(attempt.shopkeeperLevel());
    return attempt.ownedShops() >= limit
        ? Optional.of(new CreationProblem.LimitReached(limit))
        : Optional.empty();
  }

  static Optional<CreationProblem> chestShopsNeedAContainer(CreationAttempt attempt) {
    return attempt.owner() instanceof OwnerLine.Creator
            && attempt.container() == CreationAttempt.Container.NONE
        ? Optional.of(new CreationProblem.NoContainer())
        : Optional.empty();
  }

  static Optional<CreationProblem> containerIsNotSomeoneElses(CreationAttempt attempt) {
    return attempt.container() == CreationAttempt.Container.TAKEN
        ? Optional.of(new CreationProblem.ContainerTaken())
        : Optional.empty();
  }
}
