package com.shepherdjerred.thestorm.shops.app;

import com.shepherdjerred.thestorm.shops.domain.catalog.Catalog;
import com.shepherdjerred.thestorm.shops.domain.price.PriceLoops;
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
 * business and are not checked. Main thread only.
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
    var candidate = offer(shop, shop.item().orElseThrow());
    var existing = new ArrayList<>(catalogOffers);
    for (var other : registry.all()) {
      if (other.isAdmin() && other.id() != shop.id() && other.item().isPresent()) {
        existing.add(offer(other, other.item().orElseThrow()));
      }
    }
    return PriceLoops.conflict(candidate, existing)
        .map(conflict -> new CreationProblem.PriceLoop(conflict.source()));
  }

  private static PriceLoops.Offer offer(SignShop shop, ItemFingerprint item) {
    return new PriceLoops.Offer(itemId(item), shop.quantity(), shop.prices(), "another admin shop");
  }

  /** A plain item is its key, matching catalog entries; a variant is its whole fingerprint. */
  static String itemId(ItemFingerprint item) {
    return item.special() ? "variant:" + item.template() : item.material();
  }
}
