package com.shepherdjerred.thestorm.shops.domain.sign;

import com.shepherdjerred.thestorm.core.result.Result;
import com.shepherdjerred.thestorm.shops.domain.price.ShopPrices;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;

/**
 * Reads a sign a player wrote into a shop draft, collecting every problem at once so the player can
 * fix the sign in one go.
 *
 * <pre>
 * line 1  owner      filled in with the creator's name, or the admin-shop label
 * line 2  quantity   items per trade, 1..maxQuantity
 * line 3  prices     B 50:S 40, either side optional
 * line 4  item       an item name, or ? to set it by clicking with the item
 * </pre>
 */
public final class ShopSignParser {

  private final int maxQuantity;
  private final String adminShopLabel;

  public ShopSignParser(int maxQuantity, String adminShopLabel) {
    if (maxQuantity < 1) {
      throw new IllegalArgumentException("maxQuantity must be positive: " + maxQuantity);
    }
    if (adminShopLabel.isBlank()) {
      throw new IllegalArgumentException("the admin shop label must not be blank");
    }
    this.maxQuantity = maxQuantity;
    this.adminShopLabel = adminShopLabel.strip();
  }

  /**
   * Whether the player meant this sign to be a shop: a quantity and something that looks like a
   * price. Ordinary signs are left alone rather than answered with shop errors.
   */
  public boolean looksLikeShop(SignLines lines) {
    return !lines.quantity().isBlank()
        && (PriceLine.looksLikePrices(lines.prices()) || isAdminShop(lines.owner()));
  }

  public Result<ShopSignDraft, List<SignProblem>> parse(SignLines lines) {
    var problems = new ArrayList<SignProblem>();
    var quantity = collect(QuantityLine.parse(lines.quantity(), maxQuantity), problems);
    var prices = collectAll(PriceLine.parse(lines.prices()), problems);
    var item = collect(item(lines.item()), problems);
    if (!problems.isEmpty()) {
      return Result.err(List.copyOf(problems));
    }
    return Result.ok(
        new ShopSignDraft(
            owner(lines.owner()),
            quantity.orElseThrow(),
            prices.orElseThrow(),
            item.orElseThrow()));
  }

  private OwnerLine owner(String line) {
    return isAdminShop(line) ? new OwnerLine.AdminShop() : new OwnerLine.Creator();
  }

  private boolean isAdminShop(String line) {
    return line.strip().equalsIgnoreCase(adminShopLabel);
  }

  private static Result<ItemLine, SignProblem> item(String line) {
    var text = line.strip();
    if (text.isEmpty()) {
      return Result.err(new SignProblem.MissingItem());
    }
    return Result.ok(
        text.equals(ItemLine.PENDING_MARKER) ? new ItemLine.Pending() : new ItemLine.Named(text));
  }

  private static <T> Optional<T> collect(Result<T, SignProblem> result, List<SignProblem> into) {
    return switch (result) {
      case Result.Ok<T, SignProblem>(var value) -> Optional.of(value);
      case Result.Err<T, SignProblem>(var problem) -> {
        into.add(problem);
        yield Optional.empty();
      }
    };
  }

  private static Optional<ShopPrices> collectAll(
      Result<ShopPrices, List<SignProblem>> result, List<SignProblem> into) {
    return switch (result) {
      case Result.Ok<ShopPrices, List<SignProblem>>(var value) -> Optional.of(value);
      case Result.Err<ShopPrices, List<SignProblem>>(var problems) -> {
        into.addAll(problems);
        yield Optional.empty();
      }
    };
  }
}
