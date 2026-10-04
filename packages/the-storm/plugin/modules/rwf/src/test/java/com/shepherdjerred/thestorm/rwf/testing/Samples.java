package com.shepherdjerred.thestorm.rwf.testing;

import com.shepherdjerred.thestorm.rwf.domain.combatant.CombatantId;
import com.shepherdjerred.thestorm.rwf.domain.combatant.TeamColor;
import com.shepherdjerred.thestorm.rwf.domain.geometry.BlockPos;
import com.shepherdjerred.thestorm.rwf.domain.geometry.Cuboid;
import com.shepherdjerred.thestorm.rwf.domain.geometry.Spawn;
import com.shepherdjerred.thestorm.rwf.domain.map.BombOwner;
import com.shepherdjerred.thestorm.rwf.domain.map.BombSite;
import com.shepherdjerred.thestorm.rwf.domain.map.MapDefinition;
import com.shepherdjerred.thestorm.rwf.domain.map.MapTeam;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

/** Small, valid domain values for tests. */
public final class Samples {

  public static final Instant T0 = Instant.parse("2026-10-03T12:00:00Z");
  public static final UUID MATCH = UUID.fromString("00000000-0000-0000-0000-0000000000ff");
  public static final long SEED = 7;

  public static final CombatantId.Human ALICE = human("a");
  public static final CombatantId.Human BOB = human("b");
  public static final CombatantId.Human CAROL = human("c");
  public static final CombatantId.Human DAVE = human("d");
  public static final CombatantId.Human ERIN = human("e");
  public static final CombatantId.Human FRANK = human("f");
  public static final CombatantId.Bot BOT_1 = new CombatantId.Bot("rusher", uuid("1"));
  public static final CombatantId.Bot BOT_2 = new CombatantId.Bot("camper", uuid("2"));

  public static final String SHA = "0".repeat(63) + "1";
  public static final Cuboid BORDER =
      new Cuboid(new BlockPos(-50, 0, -50), new BlockPos(50, 100, 50));

  public static final BlockPos RED_BOMB = new BlockPos(-20, 64, 0);
  public static final BlockPos BLUE_BOMB = new BlockPos(20, 64, 0);
  public static final BlockPos GREEN_BOMB = new BlockPos(0, 64, 20);
  public static final BlockPos NUKE = new BlockPos(0, 64, -20);

  private Samples() {}

  public static CombatantId.Human human(String suffix) {
    return new CombatantId.Human(uuid(suffix));
  }

  private static UUID uuid(String suffix) {
    return UUID.fromString("00000000-0000-0000-0000-00000000000" + suffix);
  }

  public static MapTeam team(TeamColor color, BlockPos... spawns) {
    var list = new ArrayList<Spawn>();
    for (var spawn : spawns) {
      list.add(Spawn.at(spawn));
    }
    return new MapTeam(color, list);
  }

  public static MapTeam red() {
    return team(TeamColor.RED, new BlockPos(-30, 64, 0), new BlockPos(-30, 64, 2));
  }

  public static MapTeam blue() {
    return team(TeamColor.BLUE, new BlockPos(30, 64, 0), new BlockPos(30, 64, 2));
  }

  public static MapTeam green() {
    return team(TeamColor.GREEN, new BlockPos(0, 64, 30), new BlockPos(2, 64, 30));
  }

  public static BombSite teamBomb(String id, TeamColor team, BlockPos at) {
    return new BombSite(id, new BombOwner.Team(team), at);
  }

  public static BombSite nuke(String id, BlockPos at) {
    return new BombSite(id, new BombOwner.Nuke(), at);
  }

  public static MapDefinition map(List<MapTeam> teams, List<BombSite> bombs) {
    return new MapDefinition(
        "harbour",
        "Harbour",
        "libraryaddict",
        teams,
        bombs,
        BORDER,
        Spawn.at(new BlockPos(0, 80, 0)),
        Spawn.at(new BlockPos(0, 72, 0)),
        SHA);
  }

  /** Red and Blue, one bomb each. */
  public static MapDefinition twoTeams() {
    return map(
        List.of(red(), blue()),
        List.of(
            teamBomb("red-1", TeamColor.RED, RED_BOMB),
            teamBomb("blue-1", TeamColor.BLUE, BLUE_BOMB)));
  }

  /** Red and Blue with a nuke between them. */
  public static MapDefinition twoTeamsWithNuke() {
    return map(
        List.of(red(), blue()),
        List.of(
            teamBomb("red-1", TeamColor.RED, RED_BOMB),
            teamBomb("blue-1", TeamColor.BLUE, BLUE_BOMB),
            nuke("nuke-1", NUKE)));
  }

  /** Red, Blue and Green, one bomb each. */
  public static MapDefinition threeTeams() {
    return map(
        List.of(red(), blue(), green()),
        List.of(
            teamBomb("red-1", TeamColor.RED, RED_BOMB),
            teamBomb("blue-1", TeamColor.BLUE, BLUE_BOMB),
            teamBomb("green-1", TeamColor.GREEN, GREEN_BOMB)));
  }
}
