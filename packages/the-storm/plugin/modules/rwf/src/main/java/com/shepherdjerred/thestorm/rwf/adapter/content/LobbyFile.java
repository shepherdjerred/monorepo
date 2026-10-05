package com.shepherdjerred.thestorm.rwf.adapter.content;

import com.shepherdjerred.thestorm.rwf.domain.combatant.TeamColor;
import com.shepherdjerred.thestorm.rwf.domain.geometry.Vec3;
import com.shepherdjerred.thestorm.rwf.domain.lobby.LobbyLayout;
import java.util.List;
import java.util.regex.Pattern;

/**
 * {@code rwf/lobby/lobby.yml}: the waiting room's region, its named places and the hash of its
 * {@code blocks.schem}. Every place lies inside the region.
 *
 * @param name the display name
 * @param region the box the schematic fills, both corners included
 * @param spawn where joining players and arriving bots appear
 * @param sides one gathering place per team
 * @param alcoves one alcove per kit, in menu order
 * @param rules where the rules text floats
 * @param board where the live match board floats
 * @param balcony the watch balcony
 * @param blocksSha256 the schematic's hash, as {@code Schematic#sha256} computes it
 */
public record LobbyFile(
    String name,
    MapFile.Region region,
    PointEntry spawn,
    List<SideEntry> sides,
    List<AlcoveEntry> alcoves,
    PointEntry rules,
    PointEntry board,
    PointEntry balcony,
    String blocksSha256) {

  private static final Pattern SHA256 = Pattern.compile("[0-9a-f]{64}");

  public LobbyFile {
    if (!SHA256.matcher(blocksSha256).matches()) {
      throw new IllegalArgumentException("blocksSha256 must be 64 lower-case hex digits");
    }
    sides = List.copyOf(sides);
    alcoves = List.copyOf(alcoves);
    // Compact constructors run before the fields exist: validate from the parameters.
    var _ = layout(new Fields(name, region, spawn, sides, alcoves, rules, board, balcony));
  }

  /** The components the layout is built from, so validation can run before the record exists. */
  private record Fields(
      String name,
      MapFile.Region region,
      PointEntry spawn,
      List<SideEntry> sides,
      List<AlcoveEntry> alcoves,
      PointEntry rules,
      PointEntry board,
      PointEntry balcony) {}

  public LobbyLayout toLayout() {
    return layout(new Fields(name, region, spawn, sides, alcoves, rules, board, balcony));
  }

  private static LobbyLayout layout(Fields f) {
    return new LobbyLayout(
        f.name(),
        f.region().toCuboid(),
        f.spawn().toSpawn(),
        f.sides().stream().map(SideEntry::toSide).toList(),
        f.alcoves().stream().map(AlcoveEntry::toAlcove).toList(),
        f.rules().toSpawn(),
        f.board().toSpawn(),
        f.balcony().toSpawn());
  }

  /**
   * A team's side of the room.
   *
   * @param team the team
   * @param at where its players gather, facing the room
   */
  public record SideEntry(TeamColor team, PointEntry at) {

    LobbyLayout.Side toSide() {
      return new LobbyLayout.Side(team, at.toSpawn());
    }
  }

  /**
   * A kit alcove.
   *
   * @param kit the kit it shows
   * @param display where the kit's item floats
   * @param stand where a player stands to look at it
   */
  public record AlcoveEntry(String kit, PositionEntry display, PointEntry stand) {

    LobbyLayout.Alcove toAlcove() {
      return new LobbyLayout.Alcove(kit, display.toVec(), stand.toSpawn());
    }
  }

  /**
   * A point without a facing, as the YAML writes it: {@code {x, y, z}}.
   *
   * @param x east
   * @param y up
   * @param z south
   */
  public record PositionEntry(double x, double y, double z) {

    public PositionEntry {
      var _ = new Vec3(x, y, z);
    }

    Vec3 toVec() {
      return new Vec3(x, y, z);
    }
  }
}
