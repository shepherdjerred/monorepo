package com.shepherdjerred.thestorm.arena.domain.arena;

import com.shepherdjerred.thestorm.arena.domain.geometry.BlockPos;
import com.shepherdjerred.thestorm.arena.domain.geometry.Cuboid;
import com.shepherdjerred.thestorm.arena.domain.geometry.Point;
import com.shepherdjerred.thestorm.arena.domain.geometry.Spot;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;
import java.util.regex.Pattern;

/**
 * One arena, from {@code arena/arenas/<id>.yml}. Everything but the exit and the join signs must
 * lie inside the region; the exit must lie outside it.
 *
 * @param id the arena's id, which is also its file name
 * @param name the display name
 * @param world the world the arena is in, such as {@code world}
 * @param region the box players and mobs are kept inside
 * @param lobby where players wait and pick classes
 * @param spectator where spectators watch from
 * @param exit where dead players respawn before their belongings are restored; outside the region
 * @param playerSpawns where fighters start; shared round-robin if there are more fighters
 * @param mobSpawns where mobs appear
 * @param classSigns class id to the block (usually a sign) players click to pick it
 * @param readyBlock the block players click when they are ready
 * @param lootChests hidden chests filled when a game starts and emptied when it ends
 * @param joinSigns blocks outside the arena players click to join
 * @param tier the difficulty tier, 1 (Ominous I) upward
 * @param minPlayers the fewest ready players that start a game
 * @param maxPlayers the most players in one game
 */
public record ArenaDefinition(
    String id,
    String name,
    String world,
    Cuboid region,
    Spot lobby,
    Spot spectator,
    Spot exit,
    List<Spot> playerSpawns,
    List<Point> mobSpawns,
    Map<String, BlockPos> classSigns,
    BlockPos readyBlock,
    List<BlockPos> lootChests,
    List<BlockPos> joinSigns,
    int tier,
    int minPlayers,
    int maxPlayers) {

  private static final Pattern ID = Pattern.compile("[a-z][a-z0-9-]*");
  private static final Pattern WORLD = Pattern.compile("[A-Za-z0-9_.:/-]+");

  public ArenaDefinition {
    if (!ID.matcher(id).matches()) {
      throw new IllegalArgumentException("id must be lower-case kebab-case: " + id);
    }
    if (name.isBlank()) {
      throw new IllegalArgumentException("name must not be blank");
    }
    if (!WORLD.matcher(world).matches()) {
      throw new IllegalArgumentException("invalid world name: " + world);
    }
    if (playerSpawns.isEmpty() || mobSpawns.isEmpty()) {
      throw new IllegalArgumentException("an arena needs player spawns and mob spawns");
    }
    if (tier < 1) {
      throw new IllegalArgumentException("tier must be at least 1: " + tier);
    }
    if (minPlayers < 1 || maxPlayers < minPlayers || maxPlayers > 50) {
      throw new IllegalArgumentException(
          "need 1 <= minPlayers <= maxPlayers <= 50: " + minPlayers + ", " + maxPlayers);
    }
    playerSpawns = List.copyOf(playerSpawns);
    mobSpawns = List.copyOf(mobSpawns);
    classSigns = Map.copyOf(new TreeMap<>(classSigns));
    lootChests = List.copyOf(lootChests);
    joinSigns = List.copyOf(joinSigns);
    var problems = placementProblems(region, new Placement(lobby, spectator, exit), mobSpawns);
    problems.addAll(
        blockProblems(region, playerSpawns, new Fixtures(classSigns, readyBlock, lootChests)));
    if (!problems.isEmpty()) {
      throw new IllegalArgumentException(String.join("; ", problems));
    }
  }

  /** Whether {@code block} is one of this arena's class signs, the ready block or a loot chest. */
  public boolean isFixture(BlockPos block) {
    return classSigns.containsValue(block)
        || readyBlock.equals(block)
        || lootChests.contains(block);
  }

  private record Placement(Spot lobby, Spot spectator, Spot exit) {}

  private static List<String> placementProblems(
      Cuboid region, Placement placement, List<Point> mobSpawns) {
    var problems = new ArrayList<String>();
    requireInside(region, "lobby", placement.lobby().point(), problems);
    requireInside(region, "spectator", placement.spectator().point(), problems);
    if (region.contains(placement.exit().point())) {
      problems.add("exit " + placement.exit().describe() + " must be outside the region");
    }
    for (var i = 0; i < mobSpawns.size(); i++) {
      requireInside(region, "mobSpawns[" + i + "]", mobSpawns.get(i), problems);
    }
    return problems;
  }

  private record Fixtures(
      Map<String, BlockPos> classSigns, BlockPos ready, List<BlockPos> lootChests) {}

  private static List<String> blockProblems(
      Cuboid region, List<Spot> playerSpawns, Fixtures fixtures) {
    var problems = new ArrayList<String>();
    for (var i = 0; i < playerSpawns.size(); i++) {
      requireInside(region, "playerSpawns[" + i + "]", playerSpawns.get(i).point(), problems);
    }
    var seen = new HashSet<BlockPos>();
    for (var sign : fixtures.classSigns().entrySet()) {
      requireInside(region, "classSigns." + sign.getKey(), sign.getValue().center(), problems);
      requireUnique(seen, sign.getValue(), problems);
    }
    requireInside(region, "readyBlock", fixtures.ready().center(), problems);
    requireUnique(seen, fixtures.ready(), problems);
    var chests = fixtures.lootChests();
    for (var i = 0; i < chests.size(); i++) {
      requireInside(region, "lootChests[" + i + "]", chests.get(i).center(), problems);
      requireUnique(seen, chests.get(i), problems);
    }
    return problems;
  }

  private static void requireInside(
      Cuboid region, String what, Point point, List<String> problems) {
    if (!region.contains(point)) {
      problems.add(what + " " + point.block().describe() + " is outside the region");
    }
  }

  private static void requireUnique(Set<BlockPos> seen, BlockPos block, List<String> problems) {
    if (!seen.add(block)) {
      problems.add("block " + block.describe() + " is used twice (signs, ready block, chests)");
    }
  }
}
