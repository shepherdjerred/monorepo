package com.shepherdjerred.thestorm.shops.domain.catalog;

import java.util.List;
import java.util.Optional;
import java.util.regex.Pattern;

/**
 * An NPC shop's price list, loaded from {@code plugins/TheStorm/shops/<id>.yml}. The server account
 * is on the other side of every trade, so stock never runs out.
 *
 * @param id a stable lowercase id such as {@code reynolds-supplies}; NPC content refers to it
 * @param name the shop's name, shown as the menu title
 * @param greeting what the shopkeeper says when the menu opens
 * @param entries what the shop trades, in menu order
 */
public record Catalog(String id, String name, String greeting, List<CatalogEntry> entries) {

  private static final Pattern ID = Pattern.compile("[a-z0-9]+(?:-[a-z0-9]+)*");

  public Catalog {
    if (!ID.matcher(id).matches()) {
      throw new IllegalArgumentException(
          "id must be lowercase words joined by hyphens, like reynolds-supplies: \"" + id + "\"");
    }
    if (name.isBlank()) {
      throw new IllegalArgumentException("name must not be blank");
    }
    if (greeting.isBlank()) {
      throw new IllegalArgumentException("greeting must not be blank");
    }
    entries = List.copyOf(entries);
    if (entries.isEmpty()) {
      throw new IllegalArgumentException("a catalog needs at least one entry");
    }
  }

  /** The entry trading {@code itemKey}, if any. */
  public Optional<CatalogEntry> entry(String itemKey) {
    var key = CatalogEntry.keyOf(itemKey);
    return entries.stream().filter(entry -> entry.itemKey().equals(key)).findFirst();
  }
}
