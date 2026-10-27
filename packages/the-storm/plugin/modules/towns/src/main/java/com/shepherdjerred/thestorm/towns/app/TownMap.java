package com.shepherdjerred.thestorm.towns.app;

import com.shepherdjerred.thestorm.towns.domain.map.Outline;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/** A web map that shows towns' land, such as BlueMap's. Called on the main thread. */
public interface TownMap {

  /**
   * One labelled shape, used for a personal chunk inside a camp.
   *
   * @param id stable id for this shape
   * @param name the label
   * @param outlines the shape, by world name
   */
  record Labelled(UUID id, String name, Map<String, List<Outline>> outlines) {}

  /**
   * Shows {@code townId}'s land as {@code outlines} (by world name), labelled {@code name},
   * replacing whatever it showed for that town before.
   */
  void draw(UUID townId, String name, Map<String, List<Outline>> outlines);

  /** Shows a camp and its personal chunks. The default draws each shape with {@link #draw}. */
  default void drawCamp(
      UUID townId, String name, Map<String, List<Outline>> outlines, List<Labelled> personal) {
    draw(townId, name, outlines);
    personal.forEach(piece -> draw(piece.id(), piece.name(), piece.outlines()));
  }

  /** Stops showing {@code townId}. */
  void erase(UUID townId);

  /** Stops showing every town. */
  void eraseAll();
}
