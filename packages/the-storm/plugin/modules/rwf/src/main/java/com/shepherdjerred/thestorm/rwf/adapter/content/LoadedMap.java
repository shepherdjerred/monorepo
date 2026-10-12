package com.shepherdjerred.thestorm.rwf.adapter.content;

import com.shepherdjerred.thestorm.rwf.adapter.content.details.MapDetails;
import com.shepherdjerred.thestorm.rwf.domain.map.MapDefinition;

/**
 * One map, ready to play: its definition and its blocks.
 *
 * @param definition the rules' view of the map
 * @param blocks its terrain
 */
public record LoadedMap(MapDefinition definition, MapBlocks blocks, MapDetails details) {

  public LoadedMap(MapDefinition definition, MapBlocks blocks) {
    this(definition, blocks, MapDetails.empty(definition.blocksSha256()));
  }

  public LoadedMap {
    if (!definition.blocksSha256().equals(blocks.schematic().sha256())) {
      throw new IllegalArgumentException(
          "map "
              + definition.id()
              + " declares blocksSha256 "
              + definition.blocksSha256()
              + " but blocks.schem hashes to "
              + blocks.schematic().sha256());
    }
    if (!definition.border().equals(blocks.region())) {
      throw new IllegalArgumentException("map " + definition.id() + " blocks cover another region");
    }
    for (var bomb : definition.bombs()) {
      var state = blocks.at(bomb.position()).getAsString();
      if (!state.equals(TNT)) {
        throw new IllegalArgumentException(
            "bomb "
                + bomb.id()
                + " of map "
                + definition.id()
                + " stands on "
                + state
                + ", not TNT");
      }
    }
    details.validate(blocks.schematic());
  }

  /** TNT as the server writes it: every property, even the default. */
  static final String TNT = "minecraft:tnt[unstable=false]";

  public String id() {
    return definition.id();
  }
}
