package com.shepherdjerred.thestorm.rwf.domain.kit;

import java.util.Set;

/** A frozen game's admitted kits. Every restricted pool retains a kit available to all players. */
public record KitPool(Set<String> ids) {
  public static final KitPool ALL = new KitPool(Set.of());

  public KitPool {
    ids = Set.copyOf(ids);
    var selected = ids;
    if (!KitBook.ALL.stream().map(KitSpec::id).toList().containsAll(ids)) {
      throw new IllegalArgumentException("kit pool names an unknown kit");
    }
    if (!ids.isEmpty()
        && KitBook.MILESTONE_ONE.stream().noneMatch(kit -> selected.contains(kit.id()))) {
      throw new IllegalArgumentException("kit pool needs a universally available starter kit");
    }
  }

  public boolean allows(String id) {
    return ids.isEmpty() || ids.contains(id);
  }

  public String defaultKit() {
    return KitBook.MILESTONE_ONE.stream()
        .filter(kit -> allows(kit.id()))
        .findFirst()
        .orElseThrow()
        .id();
  }
}
