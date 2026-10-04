package com.shepherdjerred.thestorm.rwf.adapter.content;

import com.shepherdjerred.thestorm.rwf.domain.combatant.TeamColor;
import com.shepherdjerred.thestorm.rwf.domain.geometry.Cuboid;
import com.shepherdjerred.thestorm.rwf.domain.map.BombOwner;
import com.shepherdjerred.thestorm.rwf.domain.map.BombSite;
import com.shepherdjerred.thestorm.rwf.domain.map.MapDefinition;
import com.shepherdjerred.thestorm.rwf.domain.map.MapTeam;
import java.util.ArrayList;
import java.util.List;

/**
 * {@code rwf/maps/<id>/map.yml}. The region is the box {@code blocks.schem} fills, corner to
 * corner; every spawn, bomb and the spectator point lie inside it.
 *
 * @param id the map id, which is also its folder name
 * @param name the display name
 * @param author who built it
 * @param region the box the schematic fills, both corners included
 * @param lobby where players wait before the match, once this map is chosen
 * @param spectator where the dead watch from
 * @param teams the teams it fields, in scoreboard order
 * @param bombs each team's bombs
 * @param nukes bombs any team may arm
 * @param blocksSha256 the schematic's hash, as {@code Schematic#sha256} computes it
 */
public record MapFile(
    String id,
    String name,
    String author,
    Region region,
    PointEntry lobby,
    PointEntry spectator,
    List<TeamEntry> teams,
    List<BombEntry> bombs,
    List<NukeEntry> nukes,
    String blocksSha256) {

  public MapFile {
    teams = List.copyOf(teams);
    bombs = List.copyOf(bombs);
    nukes = List.copyOf(nukes);
    // Compact constructors run before the fields exist: validate from the parameters.
    var _ =
        definition(
            new MapFile.Fields(
                id, name, author, region, lobby, spectator, teams, bombs, nukes, blocksSha256));
  }

  /** The components again, so validation can run before the record exists. */
  private record Fields(
      String id,
      String name,
      String author,
      Region region,
      PointEntry lobby,
      PointEntry spectator,
      List<TeamEntry> teams,
      List<BombEntry> bombs,
      List<NukeEntry> nukes,
      String blocksSha256) {}

  public MapDefinition toDefinition() {
    return definition(
        new Fields(id, name, author, region, lobby, spectator, teams, bombs, nukes, blocksSha256));
  }

  private static MapDefinition definition(Fields f) {
    var sites = new ArrayList<BombSite>();
    for (var bomb : f.bombs()) {
      sites.add(new BombSite(bomb.id(), new BombOwner.Team(bomb.team()), bomb.at().toBlock()));
    }
    for (var nuke : f.nukes()) {
      sites.add(new BombSite(nuke.id(), new BombOwner.Nuke(), nuke.at().toBlock()));
    }
    return new MapDefinition(
        f.id(),
        f.name(),
        f.author(),
        f.teams().stream().map(TeamEntry::toTeam).toList(),
        sites,
        f.region().toCuboid(),
        f.lobby().toSpawn(),
        f.spectator().toSpawn(),
        f.blocksSha256());
  }

  /**
   * A box, both corners included.
   *
   * @param min the lowest corner
   * @param max the highest corner
   */
  public record Region(BlockEntry min, BlockEntry max) {

    public Region {
      var _ = new Cuboid(min.toBlock(), max.toBlock());
    }

    Cuboid toCuboid() {
      return new Cuboid(min.toBlock(), max.toBlock());
    }
  }

  /**
   * A team and its spawns.
   *
   * @param color the team
   * @param spawns where its players start, shared in turn
   */
  public record TeamEntry(TeamColor color, List<PointEntry> spawns) {

    public TeamEntry {
      spawns = List.copyOf(spawns);
      var _ = new MapTeam(color, spawns.stream().map(PointEntry::toSpawn).toList());
    }

    MapTeam toTeam() {
      return new MapTeam(color, spawns.stream().map(PointEntry::toSpawn).toList());
    }
  }

  /**
   * A team's bomb.
   *
   * @param id a stable id such as {@code red-1}
   * @param team the owning team
   * @param at the TNT block
   */
  public record BombEntry(String id, TeamColor team, BlockEntry at) {}

  /**
   * A nuke.
   *
   * @param id a stable id such as {@code nuke-1}
   * @param at the TNT block
   */
  public record NukeEntry(String id, BlockEntry at) {}
}
