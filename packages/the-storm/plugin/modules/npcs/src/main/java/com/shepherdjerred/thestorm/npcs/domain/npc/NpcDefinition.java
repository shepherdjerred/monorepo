package com.shepherdjerred.thestorm.npcs.domain.npc;

import com.shepherdjerred.thestorm.npcs.domain.geo.Spot;
import java.util.Optional;
import java.util.Set;

/**
 * One NPC, as validated from content.
 *
 * @param id the stable content id
 * @param name the name above its head; Bedrock shows only this, so it carries the key information
 * @param description the line under the name on Java
 * @param skin its look
 * @param home where it spawns and returns to
 * @param pose the pose it holds while standing still
 * @param roles free-form role tags, such as {@code trainer} or {@code banker}
 * @param schedule the id of its daily schedule; empty to stand at home all day
 * @param dialogue the id of its dialogue; empty for none
 * @param trainer the track id it trains; empty for none
 */
public record NpcDefinition(
    String id,
    String name,
    String description,
    Skin skin,
    Spot home,
    NpcPose pose,
    Set<String> roles,
    Optional<String> schedule,
    Optional<String> dialogue,
    Optional<String> trainer) {

  public NpcDefinition {
    roles = Set.copyOf(roles);
  }

  /**
   * A fingerprint of everything applied to the entity itself (name, description, skin, pose), so a
   * changed definition can be told from an unchanged one after a restart.
   */
  public String fingerprint() {
    var canonical = String.join("\u0000", name, description, skin.describe(), pose.id());
    return Integer.toHexString(canonical.hashCode());
  }
}
