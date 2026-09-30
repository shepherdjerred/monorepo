package com.shepherdjerred.thestorm.quests.domain.engine;

import com.shepherdjerred.thestorm.quests.domain.model.Quest;
import java.util.ArrayList;
import java.util.Collection;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.TreeMap;

/**
 * The quests one player can see: the content's quests plus their own board quests.
 *
 * @param quests every quest by id
 */
public record Catalog(Map<String, Quest> quests) {

  public Catalog {
    quests = Map.copyOf(quests);
  }

  /** A catalog of {@code quests}; ids must be unique. */
  public static Catalog of(Collection<Quest> quests) {
    var byId = new TreeMap<String, Quest>();
    for (var quest : quests) {
      if (byId.put(quest.id(), quest) != null) {
        throw new IllegalArgumentException("two quests have id " + quest.id());
      }
    }
    return new Catalog(byId);
  }

  public Optional<Quest> quest(String id) {
    return Optional.ofNullable(quests.get(id));
  }

  /** The quest with {@code id}; it must exist. */
  public Quest require(String id) {
    return quest(id).orElseThrow(() -> new IllegalStateException("no quest " + id));
  }

  /** Every quest, sorted by id. */
  public List<Quest> all() {
    return new TreeMap<>(quests).values().stream().toList();
  }

  /** This plus {@code extra}. */
  public Catalog with(Collection<Quest> extra) {
    var all = new ArrayList<>(quests.values());
    all.addAll(extra);
    return of(all);
  }
}
