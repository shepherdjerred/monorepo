package com.shepherdjerred.thestorm.rwf.domain.lobby;

import com.shepherdjerred.thestorm.rwf.domain.combatant.TeamColor;
import com.shepherdjerred.thestorm.rwf.domain.geometry.BlockPos;
import com.shepherdjerred.thestorm.rwf.domain.geometry.Cuboid;
import com.shepherdjerred.thestorm.rwf.domain.geometry.Spawn;
import com.shepherdjerred.thestorm.rwf.domain.geometry.Vec3;
import java.util.ArrayList;
import java.util.EnumSet;
import java.util.HashSet;
import java.util.List;
import java.util.Optional;
import java.util.regex.Pattern;

/**
 * The lobby, a war-room base standing in its own world: the box its blocks fill and the named
 * places in it. Everything stands inside the region; the lobby is pasted, verified and repaired
 * exactly like a map.
 *
 * @param name the display name
 * @param region the box the lobby's blocks fill, both corners included
 * @param spawn where joining players and arriving bots appear
 * @param sides one place per team where its players gather, in scoreboard order
 * @param alcoves one kit alcove per kit, in menu order
 * @param rotation the wall showing the kits free this week
 * @param podiums the map-vote podiums, one per ballot place, in ballot order
 * @param leaderboards the leaderboard boards on the plaza wall
 * @param rules where the rules text floats
 * @param board where the live match board floats
 * @param balcony the watch balcony overlooking the plaza
 */
public record LobbyLayout(
    String name,
    Cuboid region,
    Spawn spawn,
    List<Side> sides,
    List<Alcove> alcoves,
    Rotation rotation,
    List<Podium> podiums,
    List<Leaderboard> leaderboards,
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
    podiums = List.copyOf(podiums);
    leaderboards = List.copyOf(leaderboards);
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
    inside(region, "rotation header", rotation.header().position());
    inside(region, "rotation stand", rotation.stand().position());
    for (var slot : rotation.slots()) {
      inside(region, "rotation slot", slot);
    }
    for (var podium : podiums) {
      inside(region, "podium click block", podium.click().center());
      inside(region, "podium display", podium.display());
      inside(region, "podium stand", podium.stand().position());
    }
    var boards = EnumSet.noneOf(Leaderboard.Stat.class);
    for (var leaderboard : leaderboards) {
      if (!boards.add(leaderboard.stat())) {
        throw new IllegalArgumentException("the lobby has two boards for " + leaderboard.stat());
      }
      inside(region, leaderboard.stat() + " board", leaderboard.display().position());
    }
  }

  private static void inside(Cuboid region, String what, Vec3 point) {
    if (!region.contains(point)) {
      throw new IllegalArgumentException(
          "the lobby's " + what + " " + point + " lies outside its region " + region);
    }
  }

  /** Whether {@code point} is inside the lobby. */
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

  /** The podium whose click block is {@code block}, by its place on the ballot. */
  public Optional<Integer> podiumAt(BlockPos block) {
    for (var i = 0; i < podiums.size(); i++) {
      if (podiums.get(i).click().equals(block)) {
        return Optional.of(i);
      }
    }
    return Optional.empty();
  }

  /** Every place a player or bot stands, by what it is for, for the verifier and the bake. */
  public List<Spawn> stands() {
    var out = new ArrayList<Spawn>();
    out.add(spawn);
    sides.forEach(side -> out.add(side.at()));
    alcoves.forEach(alcove -> out.add(alcove.stand()));
    out.add(rotation.stand());
    podiums.forEach(podium -> out.add(podium.stand()));
    out.add(balcony);
    return List.copyOf(out);
  }

  /**
   * Where one team's players gather.
   *
   * @param team the team
   * @param at the place, facing the plaza
   */
  public record Side(TeamColor team, Spawn at) {}

  /**
   * A recess showing one kit.
   *
   * @param kit the kit id
   * @param display where the kit's item floats, over its pedestal
   * @param stand where a player stands to look at it, facing the alcove
   */
  public record Alcove(String kit, Vec3 display, Spawn stand) {

    public Alcove {
      if (!KIT.matcher(kit).matches()) {
        throw new IllegalArgumentException("alcove kit must be a kit id: " + kit);
      }
    }
  }

  /**
   * The wall of kits free this week.
   *
   * @param header where its title floats
   * @param slots where each free kit's item floats, in order
   * @param stand where a player stands to read it
   */
  public record Rotation(Spawn header, List<Vec3> slots, Spawn stand) {

    public Rotation {
      slots = List.copyOf(slots);
    }
  }

  /**
   * A map-vote podium.
   *
   * @param click the block a player right-clicks to vote for this podium's map
   * @param display where the map's name, author and votes float
   * @param stand where a player stands on the podium
   */
  public record Podium(BlockPos click, Vec3 display, Spawn stand) {}

  /**
   * A leaderboard on the plaza wall.
   *
   * @param stat what it ranks
   * @param display where its text floats, facing the plaza
   */
  public record Leaderboard(Stat stat, Spawn display) {

    /** What a board ranks. */
    public enum Stat {
      KILLS,
      WINS,
      WIN_STREAK,
    }
  }
}
