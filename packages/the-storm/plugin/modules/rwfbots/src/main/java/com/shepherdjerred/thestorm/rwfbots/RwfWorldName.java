package com.shepherdjerred.thestorm.rwfbots;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;

/**
 * The one key of {@code rwf.yml} this module reads: the world matches run in. Everything else in
 * that file is rwf's business, so unknown keys are allowed here alone.
 *
 * @param world the loaded world rwf seals and plays in
 */
@JsonIgnoreProperties(ignoreUnknown = true)
record RwfWorldName(String world) {

  RwfWorldName {
    if (world.isBlank()) {
      throw new IllegalArgumentException("rwf.yml world must not be blank");
    }
  }
}
