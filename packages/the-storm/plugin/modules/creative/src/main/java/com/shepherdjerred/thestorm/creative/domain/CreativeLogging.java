package com.shepherdjerred.thestorm.creative.domain;

import java.util.ArrayList;
import java.util.List;

/**
 * CoreProtect history the creative world must keep. CoreProtect resolves these flags per world, so
 * a {@code creative.yml} beside its {@code config.yml} can turn logging off for this world alone.
 */
public record CreativeLogging(
    boolean blockPlace,
    boolean blockBreak,
    boolean signText,
    boolean buckets,
    boolean entityChange,
    boolean worldEdit) {

  /**
   * Refuses to run the creative world when CoreProtect would not record hand edits or WorldEdit
   * there. Chunk generation does not pass through this check: it writes chunk data and is not
   * player history.
   */
  public void requireFor(String world) {
    if (world.isBlank()) {
      throw new IllegalArgumentException("creative world name is required");
    }
    var missing = missing();
    if (!missing.isEmpty()) {
      throw new IllegalStateException(
          "Creative world "
              + world
              + " requires CoreProtect logging for "
              + String.join(", ", missing));
    }
  }

  private List<String> missing() {
    var missing = new ArrayList<String>();
    if (!blockPlace) {
      missing.add("block-place");
    }
    if (!blockBreak) {
      missing.add("block-break");
    }
    if (!signText) {
      missing.add("sign-text");
    }
    if (!buckets) {
      missing.add("buckets");
    }
    if (!entityChange) {
      missing.add("entity-change");
    }
    if (!worldEdit) {
      missing.add("worldedit");
    }
    return missing;
  }
}
