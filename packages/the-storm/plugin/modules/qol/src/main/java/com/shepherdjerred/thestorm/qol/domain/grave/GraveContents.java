package com.shepherdjerred.thestorm.qol.domain.grave;

import java.util.HashSet;
import java.util.List;
import java.util.Set;

/**
 * A grave and the stacks still in it.
 *
 * @param grave the grave
 * @param items its stacks, by index
 */
public record GraveContents(Grave grave, List<GraveItem> items) {

  public GraveContents {
    items = List.copyOf(items);
    var seen = new HashSet<Integer>();
    for (var item : items) {
      if (!seen.add(item.index())) {
        throw new IllegalArgumentException("duplicate item index " + item.index());
      }
    }
  }

  /** These contents without the stacks at {@code taken}. */
  public GraveContents without(Set<Integer> taken) {
    return new GraveContents(
        grave, items.stream().filter(item -> !taken.contains(item.index())).toList());
  }

  public boolean isEmpty() {
    return items.isEmpty();
  }
}
