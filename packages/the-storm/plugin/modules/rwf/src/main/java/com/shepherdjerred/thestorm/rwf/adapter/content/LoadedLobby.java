package com.shepherdjerred.thestorm.rwf.adapter.content;

import com.shepherdjerred.thestorm.rwf.domain.geometry.Spawn;
import com.shepherdjerred.thestorm.rwf.domain.lobby.LobbyLayout;
import java.util.ArrayList;

/**
 * The lobby, ready to paste: its layout, its blocks and the hash they must match. Everyone it
 * places (the spawn, the sides, the alcove and balcony stands) stands on something and has room for
 * their head.
 *
 * @param layout the room's region and named places
 * @param blocks its terrain
 * @param blocksSha256 the declared hash of {@code blocks.schem}
 */
public record LoadedLobby(LobbyLayout layout, MapBlocks blocks, String blocksSha256) {

  /** The id the lobby's terrain is logged and verified under. */
  public static final String ID = "lobby";

  public LoadedLobby {
    if (!blocksSha256.equals(blocks.schematic().sha256())) {
      throw new IllegalArgumentException(
          "the lobby declares blocksSha256 "
              + blocksSha256
              + " but blocks.schem hashes to "
              + blocks.schematic().sha256());
    }
    if (!layout.region().equals(blocks.region())) {
      throw new IllegalArgumentException("the lobby's blocks cover another region");
    }
    var stands = new ArrayList<Spawn>();
    stands.add(layout.spawn());
    stands.add(layout.balcony());
    layout.sides().forEach(side -> stands.add(side.at()));
    layout.alcoves().forEach(alcove -> stands.add(alcove.stand()));
    for (var stand : stands) {
      standable(blocks, layout, stand);
    }
  }

  private static void standable(MapBlocks blocks, LobbyLayout layout, Spawn stand) {
    var feet = stand.position().toBlock();
    var floor = feet.plus(0, -1, 0);
    if (!layout.region().contains(floor) || blocks.at(floor).getMaterial().isAir()) {
      throw new IllegalArgumentException("nothing to stand on under the lobby's " + stand);
    }
    for (var up = 0; up <= 1; up++) {
      var body = feet.plus(0, up, 0);
      if (layout.region().contains(body) && !blocks.at(body).getMaterial().isAir()) {
        throw new IllegalArgumentException("the lobby's " + stand + " stands inside a block");
      }
    }
  }
}
