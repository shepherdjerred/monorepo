package com.shepherdjerred.thestorm.shops.app;

import com.shepherdjerred.thestorm.shops.domain.catalog.Catalog;
import com.shepherdjerred.thestorm.shops.domain.price.PriceLoops;
import com.shepherdjerred.thestorm.shops.domain.price.ShopPrices;
import com.shepherdjerred.thestorm.shops.domain.shop.CreationProblem;
import com.shepherdjerred.thestorm.shops.domain.shop.ItemFingerprint;
import com.shepherdjerred.thestorm.shops.domain.shop.SignShop;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;

/**
 * Every price the server itself offers: admin sign shops and NPC catalogs. An admin shop may not
 * pay more per item than any of them charges, or charge less than any of them pays, or players
 * could trade with the server in a loop and print crystals. Player shops are the owners' own
 * business and are not checked.
 *
 * <p>A variant (enchanted, renamed, ...) can always be turned back into the plain item with a
 * grindstone or anvil, so what a server shop charges for a variant also counts as a price for the
 * plain item: selling a renamed diamond below what a catalog pays for diamonds is a loop. The
 * reverse is not, since a plain item cannot be made into that exact variant for free. Main thread
 * only.
 */
public final class ServerOffers {

  private final List<PriceLoops.Offer> catalogOffers;
  private final ShopRegistry registry;

  public ServerOffers(List<Catalog> catalogs, ShopRegistry registry) {
    var offers = new ArrayList<PriceLoops.Offer>();
    for (var catalog : catalogs) {
      for (var entry : catalog.entries()) {
        offers.add(
            new PriceLoops.Offer(
                entry.itemKey(), entry.quantity(), entry.prices(), catalog.name()));
      }
    }
    this.catalogOffers = List.copyOf(offers);
    this.registry = registry;
  }

  /** Why {@code shop}'s prices would loop with the server's, if it is an admin shop and would. */
  public Optional<CreationProblem> check(SignShop shop) {
    if (!shop.isAdmin() || shop.item().isEmpty()) {
      return Optional.empty();
    }
    var existing = new ArrayList<>(catalogOffers);
    for (var other : registry.all()) {
      if (other.isAdmin() && other.id() != shop.id() && other.item().isPresent()) {
        existing.addAll(offers(other, other.item().orElseThrow()));
      }
    }
    return offers(shop, shop.item().orElseThrow()).stream()
        .flatMap(candidate -> PriceLoops.conflict(candidate, existing).stream())
        .findFirst()
        .map(conflict -> new CreationProblem.PriceLoop(conflict.source()));
  }

  /**
   * The offers an admin shop makes: its own, and for a variant it sells, the same price for the
   * plain item the variant reduces to.
   */
  private static List<PriceLoops.Offer> offers(SignShop shop, ItemFingerprint item) {
    var source = "another admin shop";
    var own = new PriceLoops.Offer(itemId(item), shop.quantity(), shop.prices(), source);
    var charged = shop.prices().buy();
    if (!item.special() || charged.isEmpty()) {
      return List.of(own);
    }
    var reduced =
        new PriceLoops.Offer(
            item.material(), shop.quantity(), new ShopPrices(charged, Optional.empty()), source);
    return List.of(own, reduced);
  }

  /** A plain item is its key, matching catalog entries; a variant is its whole fingerprint. */
  static String itemId(ItemFingerprint item) {
    return item.special() ? "variant:" + item.template() : item.material();
  }
}
