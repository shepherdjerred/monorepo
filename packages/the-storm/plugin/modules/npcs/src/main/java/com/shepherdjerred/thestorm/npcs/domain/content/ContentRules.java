package com.shepherdjerred.thestorm.npcs.domain.content;

import java.util.Set;

/**
 * Facts from outside the content that it must agree with.
 *
 * @param worlds the keys of the server's loaded worlds
 * @param trainerTracks the track ids a trainer may teach
 */
public record ContentRules(Set<String> worlds, Set<String> trainerTracks) {

  public ContentRules {
    worlds = Set.copyOf(worlds);
    trainerTracks = Set.copyOf(trainerTracks);
  }
}
