package com.shepherdjerred.thestorm.rwfbots.domain.world;

import java.util.AbstractList;
import java.util.HashMap;
import java.util.Iterator;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.RandomAccess;
import java.util.Spliterator;

/** Immutable snapshot order plus an identity index, shared by all readers of that snapshot. */
final class CombatantList extends AbstractList<CombatantView> implements RandomAccess {
  private final List<CombatantView> ordered;
  private final Map<CombatantId, CombatantView> indexed;

  CombatantList(List<CombatantView> combatants) {
    ordered = List.copyOf(combatants);
    var index = new HashMap<CombatantId, CombatantView>();
    for (var combatant : ordered) {
      if (index.putIfAbsent(combatant.id(), combatant) != null)
        throw new IllegalArgumentException("combatant ids must be unique");
    }
    indexed = Map.copyOf(index);
  }

  Optional<CombatantView> find(CombatantId id) {
    return Optional.ofNullable(indexed.get(id));
  }

  @Override
  public CombatantView get(int index) {
    return ordered.get(index);
  }

  @Override
  public int size() {
    return ordered.size();
  }

  @Override
  public Iterator<CombatantView> iterator() {
    return ordered.iterator();
  }

  @Override
  public Spliterator<CombatantView> spliterator() {
    return ordered.spliterator();
  }
}
