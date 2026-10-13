package com.shepherdjerred.thestorm.rwfbots;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;

/**
 * The one key of {@code rwf.yml} this module reads: the two worlds rwf runs in. Everything else in
 * that file is rwf's business, so unknown keys are allowed here alone.
 *
 * @param worlds the loaded lobby and map worlds rwf seals and plays in
 */
@JsonIgnoreProperties(ignoreUnknown = true)
record RwfWorldName(Worlds worlds) {

  /**
   * The lobby world and the map world.
   *
   * @param lobby where bots wait and wander before a match
   * @param maps where matches are fought
   */
  record Worlds(String lobby, String maps) {

    Worlds {
      if (lobby.isBlank() || maps.isBlank()) {
        throw new IllegalArgumentException("rwf.yml worlds must not be blank");
      }
    }
  }
}
