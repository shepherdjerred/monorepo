package com.shepherdjerred.thestorm.essentials.domain.kit;

import java.time.Duration;
import java.util.List;

/**
 * A named set of items players claim with {@code /kit}.
 *
 * @param items the item stacks
 * @param books written books handed out with the items
 * @param cooldown time between claims; ignored when {@code once} is set
 * @param once the kit can be claimed a single time, ever (the starter kit)
 */
public record Kit(List<KitItem> items, List<BookContent> books, Duration cooldown, boolean once) {

  public Kit {
    if (items.isEmpty() && books.isEmpty()) {
      throw new IllegalArgumentException("a kit must hold at least one item or book");
    }
    if (cooldown.isNegative()) {
      throw new IllegalArgumentException("cooldown must not be negative: " + cooldown);
    }
    items = List.copyOf(items);
    books = List.copyOf(books);
  }
}
