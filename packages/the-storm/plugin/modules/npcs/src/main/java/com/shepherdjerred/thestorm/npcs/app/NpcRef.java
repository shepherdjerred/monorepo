package com.shepherdjerred.thestorm.npcs.app;

import com.shepherdjerred.thestorm.npcs.domain.npc.NpcDefinition;
import java.util.Optional;
import java.util.Set;

/**
 * An NPC as other modules see it.
 *
 * @param id its content id
 * @param name its display name
 * @param roles its role tags, such as {@code trainer} or {@code banker}
 * @param trainer the track id it trains, if any
 */
public record NpcRef(String id, String name, Set<String> roles, Optional<String> trainer) {

  public NpcRef {
    roles = Set.copyOf(roles);
  }

  public static NpcRef of(NpcDefinition npc) {
    return new NpcRef(npc.id(), npc.name(), npc.roles(), npc.trainer());
  }
}
