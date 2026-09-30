package com.shepherdjerred.thestorm.towns.app;

import com.shepherdjerred.thestorm.towns.domain.map.Outline;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/** A web map that shows towns' land, such as BlueMap's. Called on the main thread. */
public interface TownMap {

  /**
   * Shows {@code townId}'s land as {@code outlines} (by world name), labelled {@code name},
   * replacing whatever it showed for that town before.
   */
  void draw(UUID townId, String name, Map<String, List<Outline>> outlines);

  /** Stops showing {@code townId}. */
  void erase(UUID townId);

  /** Stops showing every town. */
  void eraseAll();
}
