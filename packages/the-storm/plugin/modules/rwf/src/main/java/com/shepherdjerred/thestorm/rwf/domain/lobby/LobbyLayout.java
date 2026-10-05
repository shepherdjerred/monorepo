package com.shepherdjerred.thestorm.rwf.domain.lobby;

import com.shepherdjerred.thestorm.rwf.domain.combatant.TeamColor;
import com.shepherdjerred.thestorm.rwf.domain.geometry.Cuboid;
import com.shepherdjerred.thestorm.rwf.domain.geometry.Spawn;
import com.shepherdjerred.thestorm.rwf.domain.geometry.Vec3;
import java.util.EnumSet;
import java.util.HashSet;
import java.util.List;
import java.util.Optional;
import java.util.regex.Pattern;

/**
 * The lobby room: the box its blocks fill and the named places in it. Everything stands inside the
 * region; the room is pasted, verified and repaired exactly like a map.
 *
 * @param name the display name
 * @param region the box the lobby's blocks fill, both corners included
 * @param spawn where joining players and arriving bots appear
 * @param sides one place per team where its players gather, in scoreboard order
 * @param alcoves one kit alcove per kit, in menu order
 * @param rules where the rules text floats, in front of the rules wall
 * @param board where the live match board floats
 * @param balcony the watch balcony overlooking the window
 */
public record LobbyLayout(
    String name,
    Cuboid region,
    Spawn spawn,
    List<Side> sides,
    List<Alcove> alcoves,
    Spawn rules,
    Spawn board,
    Spawn balcony) {

  private static final Pattern KIT = Pattern.compile("[a-z][a-z0-9-]*");

  public LobbyLayout {
    if (name.isBlank()) {
      throw new IllegalArgumentException("the lobby name must not be blank");
    }
    sides = List.copyOf(sides);
    alcoves = List.copyOf(alcoves);
    inside(region, "spawn", spawn.position());
    inside(region, "rules", rules.position());
    inside(region, "board", board.position());
    inside(region, "balcony", balcony.position());
    var teams = EnumSet.noneOf(TeamColor.class);
    for (var side : sides) {
      if (!teams.add(side.team())) {
        throw new IllegalArgumentException("the lobby has two sides for " + side.team());
      }
      inside(region, side.team() + " side", side.at().position());
    }
    if (alcoves.isEmpty()) {
      throw new IllegalArgumentException("the lobby needs at least one kit alcove");
    }
    var kits = new HashSet<String>();
    for (var alcove : alcoves) {
      if (!kits.add(alcove.kit())) {
        throw new IllegalArgumentException("the lobby has two alcoves for kit " + alcove.kit());
      }
      inside(region, "alcove " + alcove.kit() + " display", alcove.display());
      inside(region, "alcove " + alcove.kit() + " stand", alcove.stand().position());
    }
  }

  private static void inside(Cuboid region, String what, Vec3 point) {
    if (!region.contains(point)) {
      throw new IllegalArgumentException(
          "the lobby's " + what + " " + point + " lies outside its region " + region);
    }
  }

  /** Whether {@code point} is inside the room. */
  public boolean contains(Vec3 point) {
    return region.contains(point);
  }

  /** The kits the alcoves show, in menu order. */
  public List<String> kits() {
    return alcoves.stream().map(Alcove::kit).toList();
  }

  public Optional<Alcove> alcove(String kit) {
    return alcoves.stream().filter(alcove -> alcove.kit().equals(kit)).findFirst();
  }

  public Optional<Side> side(TeamColor team) {
    return sides.stream().filter(side -> side.team() == team).findFirst();
  }

  /**
   * Where one team's players gather.
   *
   * @param team the team
   * @param at the place, facing the room
   */
  public record Side(TeamColor team, Spawn at) {}

  /**
   * A recess in the wall showing one kit.
   *
   * @param kit the kit id
   * @param display where the kit's item floats, inside the alcove
   * @param stand where a player stands to look at it, facing the alcove
   */
  public record Alcove(String kit, Vec3 display, Spawn stand) {

    public Alcove {
      if (!KIT.matcher(kit).matches()) {
        throw new IllegalArgumentException("alcove kit must be a kit id: " + kit);
      }
    }
  }
}
