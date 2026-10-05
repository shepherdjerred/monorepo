package com.shepherdjerred.thestorm.rwfbots.domain.lobby;

import com.shepherdjerred.thestorm.rwfbots.domain.map.NavArtifact;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

/**
 * The lobby's baked navigation, as the rwfmap tool names its places and bots read them: the lobby
 * is baked like a map, with its named places as spawn sites and no bombs. An artifact is usable
 * when the spawn is walkable, every other place stands on a node the spawn reaches, and each has
 * its distance field.
 */
public final class LobbyNav {

  /** The map id the lobby's artifact is baked under. */
  public static final String ID = "lobby";

  /** Where joining players and arriving bots appear. */
  public static final String SPAWN = "lobby-spawn";

  /** The watch balcony. */
  public static final String BALCONY = "balcony";

  private LobbyNav() {}

  /** The site of the alcove showing {@code kit}. */
  public static String alcove(String kit) {
    return "alcove-" + kit;
  }

  /** The site of {@code team}'s side of the room, by the team's lower-case name. */
  public static String side(String team) {
    return "side-" + team.toLowerCase(Locale.ROOT);
  }

  /** Everything that makes {@code artifact} unusable as the lobby; empty when it is usable. */
  public static List<String> problems(NavArtifact artifact) {
    var problems = new ArrayList<String>();
    if (!artifact.mapId().equals(ID)) {
      problems.add("the artifact names map " + artifact.mapId() + ", not " + ID);
    }
    if (!artifact.sites().bombs().isEmpty()) {
      problems.add("the lobby has no bombs, but the artifact lists " + artifact.sites().bombs());
    }
    var spawn = artifact.sites().spawn(SPAWN);
    if (spawn.isEmpty()) {
      problems.add("no " + SPAWN + " site");
      return problems;
    }
    var from = artifact.graph().nodeAt(spawn.orElseThrow().cell());
    if (from.isEmpty()) {
      problems.add(SPAWN + " at " + spawn.orElseThrow().cell() + " is not walkable");
      return problems;
    }
    for (var site : artifact.sites().spawns()) {
      if (!artifact.distanceFields().containsKey(site.name())) {
        problems.add(site.name() + " has no distance field");
      }
      var node = artifact.graph().nodeAt(site.cell());
      if (node.isEmpty()) {
        problems.add(site.name() + " at " + site.cell() + " is not walkable");
      } else if (artifact.graph().path(from.getAsInt(), node.getAsInt()).isEmpty()) {
        problems.add(site.name() + " cannot be reached from " + SPAWN);
      }
    }
    return problems;
  }
}
