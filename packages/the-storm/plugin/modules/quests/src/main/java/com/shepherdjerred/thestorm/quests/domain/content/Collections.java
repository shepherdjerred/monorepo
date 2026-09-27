package com.shepherdjerred.thestorm.quests.domain.content;

import java.util.List;
import java.util.Map;
import java.util.TreeMap;

/** Authored discoveries, grouped as regional field notes in the quest journal. */
public record Collections(Map<String, Entry> entries) {

  public Collections {
    entries = Map.copyOf(entries);
  }

  /** One collectible item and the note revealed by its first eligible pickup. */
  public record Entry(String id, String name, String material, String region, String note) {}

  /** Entries matching a material, in stable id order. */
  public List<Entry> matching(String material) {
    return new TreeMap<>(entries)
        .values().stream().filter(entry -> entry.material().equals(material)).toList();
  }
}
