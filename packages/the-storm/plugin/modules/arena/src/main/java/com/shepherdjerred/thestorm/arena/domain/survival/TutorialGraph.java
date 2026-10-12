package com.shepherdjerred.thestorm.arena.domain.survival;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;

/** Stable topological arbitration teaches prerequisites in the context that revealed a feature. */
public final class TutorialGraph {
  public record Tip(TutorialKey key, String text, Set<TutorialKey> parents) {
    public Tip {
      parents = Set.copyOf(parents);
      if (text.isBlank()) throw new IllegalArgumentException("Empty tutorial");
    }
  }

  private final Map<TutorialKey, Tip> tips = new LinkedHashMap<>();
  private final List<Tip> order;

  public TutorialGraph(List<Tip> source) {
    for (var tip : source)
      if (tips.put(tip.key(), tip) != null)
        throw new IllegalArgumentException("Duplicate tutorial " + tip.key());
    for (var tip : source)
      if (!tips.keySet().containsAll(tip.parents()))
        throw new IllegalArgumentException("Missing tutorial prerequisite");
    var sorted = new ArrayList<Tip>();
    var ready = new HashSet<TutorialKey>();
    while (sorted.size() < tips.size()) {
      var next =
          tips.values().stream()
              .filter(tip -> !ready.contains(tip.key()) && ready.containsAll(tip.parents()))
              .findFirst();
      if (next.isEmpty()) throw new IllegalArgumentException("Tutorial dependency cycle");
      sorted.add(next.orElseThrow());
      ready.add(next.orElseThrow().key());
    }
    order = List.copyOf(sorted);
  }

  public List<Tip> tips() {
    return order;
  }

  public Optional<Tip> next(Set<TutorialKey> contexts, Set<TutorialKey> seen) {
    var relevant = new HashSet<TutorialKey>();
    contexts.forEach(key -> ancestors(key, relevant));
    return order.stream()
        .filter(
            tip ->
                relevant.contains(tip.key())
                    && !seen.contains(tip.key())
                    && seen.containsAll(tip.parents()))
        .findFirst();
  }

  private void ancestors(TutorialKey key, Set<TutorialKey> relevant) {
    if (!relevant.add(key)) return;
    var tip = tips.get(key);
    if (tip == null) throw new IllegalArgumentException("Unknown tutorial " + key);
    tip.parents().forEach(parent -> ancestors(parent, relevant));
  }
}
