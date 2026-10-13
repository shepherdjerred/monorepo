package com.shepherdjerred.thestorm.rwf.adapter.content;

import com.shepherdjerred.thestorm.rwf.domain.combatant.TeamColor;
import com.shepherdjerred.thestorm.rwf.domain.geometry.Vec3;
import com.shepherdjerred.thestorm.rwf.domain.lobby.LobbyLayout;
import java.util.List;
import java.util.regex.Pattern;

/**
 * {@code rwf/lobby/lobby.yml}: the lobby's region in the lobby world, its named places and the hash
 * of its {@code blocks.schem}. Every place lies inside the region.
 *
 * @param name the display name
 * @param region the box the schematic fills, both corners included
 * @param spawn where joining players and arriving bots appear
 * @param sides one gathering place per team
 * @param alcoves one alcove per kit, in menu order
 * @param rotation the wall of kits free this week
 * @param podiums the map-vote podiums, in ballot order
 * @param leaderboards the leaderboard boards
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
    RotationEntry rotation,
    List<PodiumEntry> podiums,
    List<LeaderboardEntry> leaderboards,
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
    podiums = List.copyOf(podiums);
    leaderboards = List.copyOf(leaderboards);
    // Compact constructors run before the fields exist: validate from the parameters.
    var _ =
        layout(
            new Fields(
                name,
                region,
                spawn,
                sides,
                alcoves,
                rotation,
                podiums,
                leaderboards,
                rules,
                board,
                balcony));
  }

  /** The components the layout is built from, so validation can run before the record exists. */
  private record Fields(
      String name,
      MapFile.Region region,
      PointEntry spawn,
      List<SideEntry> sides,
      List<AlcoveEntry> alcoves,
      RotationEntry rotation,
      List<PodiumEntry> podiums,
      List<LeaderboardEntry> leaderboards,
      PointEntry rules,
      PointEntry board,
      PointEntry balcony) {}

  public LobbyLayout toLayout() {
    return layout(
        new Fields(
            name,
            region,
            spawn,
            sides,
            alcoves,
            rotation,
            podiums,
            leaderboards,
            rules,
            board,
            balcony));
  }

  private static LobbyLayout layout(Fields f) {
    return new LobbyLayout(
        f.name(),
        f.region().toCuboid(),
        f.spawn().toSpawn(),
        f.sides().stream().map(SideEntry::toSide).toList(),
        f.alcoves().stream().map(AlcoveEntry::toAlcove).toList(),
        f.rotation().toRotation(),
        f.podiums().stream().map(PodiumEntry::toPodium).toList(),
        f.leaderboards().stream().map(LeaderboardEntry::toLeaderboard).toList(),
        f.rules().toSpawn(),
        f.board().toSpawn(),
        f.balcony().toSpawn());
  }

  /**
   * A team's side of the plaza.
   *
   * @param team the team
   * @param at where its players gather
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
   * The wall of kits free this week.
   *
   * @param header where its title floats
   * @param slots where each free kit's item floats
   * @param stand where a player stands to read it
   */
  public record RotationEntry(PointEntry header, List<PositionEntry> slots, PointEntry stand) {

    public RotationEntry {
      slots = List.copyOf(slots);
    }

    LobbyLayout.Rotation toRotation() {
      return new LobbyLayout.Rotation(
          header.toSpawn(), slots.stream().map(PositionEntry::toVec).toList(), stand.toSpawn());
    }
  }

  /**
   * A map-vote podium.
   *
   * @param click the block a player right-clicks to vote
   * @param display where the map's name and votes float
   * @param stand where a player stands on the podium
   */
  public record PodiumEntry(BlockEntry click, PositionEntry display, PointEntry stand) {

    LobbyLayout.Podium toPodium() {
      return new LobbyLayout.Podium(click.toBlock(), display.toVec(), stand.toSpawn());
    }
  }

  /**
   * A leaderboard.
   *
   * @param stat what it ranks
   * @param display where its text floats, facing the plaza
   */
  public record LeaderboardEntry(LobbyLayout.Leaderboard.Stat stat, PointEntry display) {

    LobbyLayout.Leaderboard toLeaderboard() {
      return new LobbyLayout.Leaderboard(stat, display.toSpawn());
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
