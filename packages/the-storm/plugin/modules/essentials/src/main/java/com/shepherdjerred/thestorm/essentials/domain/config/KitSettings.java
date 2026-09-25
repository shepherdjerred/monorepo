package com.shepherdjerred.thestorm.essentials.domain.config;

import com.shepherdjerred.thestorm.essentials.domain.kit.Kit;
import com.shepherdjerred.thestorm.essentials.domain.place.PlaceName;
import java.util.Map;
import java.util.TreeMap;

/**
 * The kits players can claim.
 *
 * @param starter the kit every new player receives on their first join; must be in {@code kits}
 * @param kits kit name (a valid {@link PlaceName}) to kit
 */
public record KitSettings(String starter, Map<String, Kit> kits) {

  public KitSettings {
    for (var name : kits.keySet()) {
      if (!PlaceName.parse(name).fold(parsed -> parsed.value().equals(name), error -> false)) {
        throw new IllegalArgumentException(
            "kit names are lowercase letters, digits, _ or -: " + name);
      }
    }
    if (!kits.containsKey(starter)) {
      throw new IllegalArgumentException("starter kit '" + starter + "' is not defined in kits");
    }
    kits = Map.copyOf(new TreeMap<>(kits));
  }

  /** The starter kit. */
  public Kit starterKit() {
    var kit = kits.get(starter);
    if (kit == null) {
      throw new IllegalStateException("starter kit vanished: " + starter);
    }
    return kit;
  }
}
