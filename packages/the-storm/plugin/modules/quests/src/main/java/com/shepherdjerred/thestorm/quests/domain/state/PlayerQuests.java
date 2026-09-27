package com.shepherdjerred.thestorm.quests.domain.state;

import static java.util.Collections.unmodifiableMap;

import com.shepherdjerred.thestorm.quests.domain.model.Action.NpcMark;
import java.util.Map;
import java.util.Optional;
import java.util.TreeMap;
import java.util.UUID;
import java.util.function.UnaryOperator;

/**
 * Everything the quests module remembers about one player. Immutable; every change makes a new
 * value, so a snapshot can be saved off the main thread while play goes on.
 *
 * @param player the player's id
 * @param active quests taken and not finished, by quest id
 * @param completions finished quests, by quest id
 * @param variables quest variables and flags (a flag is a variable set to 1)
 * @param reputation reputation per faction id
 * @param points quest points
 * @param tracked the quest shown in the sidebar, if any
 * @param board the radiant quest board
 * @param marks markers quests pinned above NPCs, shown when no quest needs the NPC
 */
public record PlayerQuests(
    UUID player,
    Map<String, ActiveQuest> active,
    Map<String, Completion> completions,
    Map<String, Long> variables,
    Map<String, Long> reputation,
    long points,
    Optional<String> tracked,
    Board board,
    Map<String, NpcMark> marks) {

  public PlayerQuests {
    active = sorted(active);
    completions = sorted(completions);
    variables = sorted(variables);
    reputation = sorted(reputation);
    marks = sorted(marks);
    for (var entry : active.entrySet()) {
      if (!entry.getKey().equals(entry.getValue().quest())) {
        throw new IllegalArgumentException("active quests are keyed by their id");
      }
    }
  }

  /** A player who has never done a quest. */
  public static PlayerQuests empty(UUID player) {
    return new PlayerQuests(
        player, Map.of(), Map.of(), Map.of(), Map.of(), 0, Optional.empty(), Board.EMPTY, Map.of());
  }

  public Optional<ActiveQuest> active(String quest) {
    return Optional.ofNullable(active.get(quest));
  }

  public Optional<Completion> completion(String quest) {
    return Optional.ofNullable(completions.get(quest));
  }

  public long variable(String name) {
    return variables.getOrDefault(name, 0L);
  }

  public long reputation(String faction) {
    return reputation.getOrDefault(faction, 0L);
  }

  public PlayerQuests withActive(ActiveQuest quest) {
    return withActiveMap(map -> put(map, quest.quest(), quest));
  }

  public PlayerQuests withoutActive(String quest) {
    return withActiveMap(map -> remove(map, quest));
  }

  public PlayerQuests withCompletion(String quest, Completion completion) {
    return new PlayerQuests(
        player,
        active,
        put(completions, quest, completion),
        variables,
        reputation,
        points,
        tracked,
        board,
        marks);
  }

  public PlayerQuests withoutCompletion(String quest) {
    return new PlayerQuests(
        player,
        active,
        remove(completions, quest),
        variables,
        reputation,
        points,
        tracked,
        board,
        marks);
  }

  public PlayerQuests withVariable(String name, long value) {
    return new PlayerQuests(
        player,
        active,
        completions,
        put(variables, name, value),
        reputation,
        points,
        tracked,
        board,
        marks);
  }

  public PlayerQuests withReputation(String faction, long value) {
    return new PlayerQuests(
        player,
        active,
        completions,
        variables,
        put(reputation, faction, value),
        points,
        tracked,
        board,
        marks);
  }

  public PlayerQuests withPoints(long value) {
    return new PlayerQuests(
        player, active, completions, variables, reputation, value, tracked, board, marks);
  }

  public PlayerQuests withTracked(Optional<String> quest) {
    return new PlayerQuests(
        player, active, completions, variables, reputation, points, quest, board, marks);
  }

  public PlayerQuests withBoard(Board next) {
    return new PlayerQuests(
        player, active, completions, variables, reputation, points, tracked, next, marks);
  }

  public PlayerQuests withMark(String npc, NpcMark mark) {
    var next = mark == NpcMark.NONE ? remove(marks, npc) : put(marks, npc, mark);
    return new PlayerQuests(
        player, active, completions, variables, reputation, points, tracked, board, next);
  }

  private PlayerQuests withActiveMap(UnaryOperator<Map<String, ActiveQuest>> change) {
    return new PlayerQuests(
        player,
        change.apply(active),
        completions,
        variables,
        reputation,
        points,
        tracked,
        board,
        marks);
  }

  private static <V> Map<String, V> sorted(Map<String, V> map) {
    return unmodifiableMap(new TreeMap<>(map));
  }

  private static <V> Map<String, V> put(Map<String, V> map, String key, V value) {
    var next = new TreeMap<>(map);
    next.put(key, value);
    return next;
  }

  private static <V> Map<String, V> remove(Map<String, V> map, String key) {
    var next = new TreeMap<>(map);
    next.remove(key);
    return next;
  }
}
