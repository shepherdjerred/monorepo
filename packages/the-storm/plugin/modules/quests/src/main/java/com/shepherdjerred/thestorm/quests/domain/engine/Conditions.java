package com.shepherdjerred.thestorm.quests.domain.engine;

import com.shepherdjerred.thestorm.quests.domain.model.Condition;
import com.shepherdjerred.thestorm.quests.domain.state.PlayerQuests;
import java.util.List;

/** Evaluates conditions against a player's quest state and the world. */
public final class Conditions {

  private Conditions() {}

  /** Whether every condition holds (true for none). */
  public static boolean all(List<Condition> conditions, PlayerQuests state, Facts facts) {
    return conditions.stream().allMatch(condition -> holds(condition, state, facts));
  }

  /** Whether {@code condition} holds. */
  public static boolean holds(Condition condition, PlayerQuests state, Facts facts) {
    return switch (condition) {
      case Condition.HasItem(var item, var amount) -> facts.count(item) >= amount;
      case Condition.TrackAtLeast(var track, var level) -> facts.trackLevel(track) >= level;
      case Condition.Completed(var quest) -> state.completion(quest).isPresent();
      case Condition.Active(var quest) -> state.active(quest).isPresent();
      case Condition.ReputationAtLeast(var faction, var amount) ->
          state.reputation(faction) >= amount;
      case Condition.PointsAtLeast(var amount) -> state.points() >= amount;
      case Condition.TimeBetween(var from, var to) -> between(facts.minuteOfDay(), from, to);
      case Condition.WeatherIs(var weather) -> facts.weather() == weather;
      case Condition.InRegion(var region) -> facts.inRegion(region);
      case Condition.HasPermission(var node) -> facts.hasPermission(node);
      case Condition.Compare(var variable, var comparison, var value) ->
          comparison.test(state.variable(variable), value);
      case Condition.Not(var inner) -> !holds(inner, state, facts);
    };
  }

  /** Whether {@code minute} is in {@code [from, to)}, wrapping past midnight. */
  static boolean between(int minute, int from, int to) {
    return from < to ? minute >= from && minute < to : minute >= from || minute < to;
  }
}
