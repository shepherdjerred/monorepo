// Ported from libraryaddict's Red Warfare
// (redwarfare-core/src/me/libraryaddict/core/map/WorldData.java and
// redwarfare-build/src/me/libraryaddict/build/customdata/SearchAndDestroyCustomData.java);
// see packages/the-storm/NOTICE.
package com.shepherdjerred.thestorm.rwf.domain.map;

import com.shepherdjerred.thestorm.rwf.domain.combatant.TeamColor;
import com.shepherdjerred.thestorm.rwf.domain.geometry.BlockPos;
import com.shepherdjerred.thestorm.rwf.domain.geometry.Cuboid;
import com.shepherdjerred.thestorm.rwf.domain.geometry.Spawn;
import java.util.EnumSet;
import java.util.HashSet;
import java.util.List;
import java.util.Optional;
import java.util.regex.Pattern;

/**
 * A Search and Destroy map, mirroring Red Warfare's {@code config.yml}: {@code Teams.<T>.Spawns},
 * {@code Custom."<T> Bombs"}, {@code Custom."PLAYER Bombs"} (nukes) and a square {@code Border}.
 *
 * <p>Validation follows the Red Warfare map builder: 2 to 10 teams, every spawn and bomb inside the
 * border, and every team owning at least one bomb unless the map has a nuke (the builder waived the
 * per-team bomb check as soon as a nuke was placed).
 *
 * @param id a stable id such as {@code harbour}
 * @param name the display name
 * @param author who built it
 * @param teams the teams it fields, in scoreboard order
 * @param bombs every bomb and nuke
 * @param border the playable region
 * @param spectatorPoint where the dead watch from
 * @param blocksSha256 a hex SHA-256 of the map's blocks, so recordings name the exact terrain
 */
public record MapDefinition(
    String id,
    String name,
    String author,
    List<MapTeam> teams,
    List<BombSite> bombs,
    Cuboid border,
    Spawn spectatorPoint,
    String blocksSha256) {

  public static final int MIN_TEAMS = 2;
  public static final int MAX_TEAMS = 10;

  private static final Pattern ID = Pattern.compile("[a-z0-9][a-z0-9-]*");
  private static final Pattern SHA256 = Pattern.compile("[0-9a-f]{64}");

  public MapDefinition {
    if (!ID.matcher(id).matches()) {
      throw new IllegalArgumentException("map id must be lower-case kebab-case: " + id);
    }
    if (name.isBlank() || author.isBlank()) {
      throw new IllegalArgumentException("map name and author must not be blank");
    }
    if (!SHA256.matcher(blocksSha256).matches()) {
      throw new IllegalArgumentException("blocksSha256 must be 64 lower-case hex digits");
    }
    teams = List.copyOf(teams);
    bombs = List.copyOf(bombs);
    checkTeams(teams, border);
    checkBombs(teams, bombs, border);
    if (!border.contains(spectatorPoint.position())) {
      throw new IllegalArgumentException("spectator point is outside the border");
    }
  }

  private static void checkTeams(List<MapTeam> teams, Cuboid border) {
    if (teams.size() < MIN_TEAMS) {
      throw new IllegalArgumentException("Not enough teams: " + teams.size());
    }
    if (teams.size() > MAX_TEAMS) {
      throw new IllegalArgumentException("Too many teams: " + teams.size());
    }
    var colors = EnumSet.noneOf(TeamColor.class);
    for (var team : teams) {
      if (!colors.add(team.color())) {
        throw new IllegalArgumentException(team.color() + " is listed twice");
      }
      for (var spawn : team.spawns()) {
        if (!border.contains(spawn.position())) {
          throw new IllegalArgumentException(
              team.color() + " has a spawn outside the border: " + spawn.position());
        }
      }
    }
  }

  private static void checkBombs(List<MapTeam> teams, List<BombSite> bombs, Cuboid border) {
    var ids = new HashSet<String>();
    var positions = new HashSet<BlockPos>();
    for (var bomb : bombs) {
      if (!ids.add(bomb.id())) {
        throw new IllegalArgumentException("bomb id is used twice: " + bomb.id());
      }
      if (!positions.add(bomb.position())) {
        throw new IllegalArgumentException("two bombs share a block: " + bomb.position());
      }
      if (!border.contains(bomb.position())) {
        throw new IllegalArgumentException("bomb is outside the border: " + bomb.id());
      }
    }
    checkOwnership(teams, bombs);
  }

  /** Every bomb's team is fielded, and every team has a bomb unless the map has a nuke. */
  private static void checkOwnership(List<MapTeam> teams, List<BombSite> bombs) {
    var fielded = EnumSet.noneOf(TeamColor.class);
    teams.forEach(team -> fielded.add(team.color()));
    var owners = EnumSet.noneOf(TeamColor.class);
    var nukes = false;
    for (var bomb : bombs) {
      switch (bomb.owner()) {
        case BombOwner.Team(var color) -> {
          if (!fielded.contains(color)) {
            throw new IllegalArgumentException(
                bomb.id() + " belongs to " + color + ", which the map does not field");
          }
          owners.add(color);
        }
        case BombOwner.Nuke _ -> nukes = true;
      }
    }
    if (nukes) {
      return;
    }
    for (var team : teams) {
      if (!owners.contains(team.color())) {
        throw new IllegalArgumentException(
            team.color().displayName() + " does not have a bomb set");
      }
    }
  }

  public Optional<MapTeam> team(TeamColor color) {
    return teams.stream().filter(team -> team.color() == color).findFirst();
  }

  public Optional<BombSite> bomb(String bombId) {
    return bombs.stream().filter(bomb -> bomb.id().equals(bombId)).findFirst();
  }

  public List<TeamColor> teamColors() {
    return teams.stream().map(MapTeam::color).toList();
  }

  public boolean hasNuke() {
    return bombs.stream().anyMatch(bomb -> bomb.owner().isNuke());
  }
}
