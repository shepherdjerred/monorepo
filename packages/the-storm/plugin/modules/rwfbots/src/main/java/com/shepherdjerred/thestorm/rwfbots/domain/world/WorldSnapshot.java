package com.shepherdjerred.thestorm.rwfbots.domain.world;

import java.util.List;
import java.util.Optional;

/**
 * Everything the bots may read about the match this tick. The adapter builds one per tick from the
 * game module and hands the same instance to every bot.
 *
 * @param tick the server tick
 * @param matchPhase where the match is
 * @param combatants everyone in the match, alive or dead
 * @param bombs every bomb and nuke
 * @param poison the late-match poison
 * @param mapId the map being played, matching the baked {@code NavArtifact}
 * @param stimuli the sounds and hit effects of this tick
 */
public record WorldSnapshot(
    long tick,
    MatchPhase matchPhase,
    List<CombatantView> combatants,
    List<BombView> bombs,
    PoisonView poison,
    String mapId,
    List<Stimulus> stimuli) {

  public WorldSnapshot {
    if (tick < 0) {
      throw new IllegalArgumentException("tick must not be negative");
    }
    if (mapId.isBlank()) {
      throw new IllegalArgumentException("map id must not be blank");
    }
    combatants = List.copyOf(combatants);
    bombs = List.copyOf(bombs);
    stimuli = List.copyOf(stimuli);
    var ids = combatants.stream().map(CombatantView::id).distinct().count();
    if (ids != combatants.size()) {
      throw new IllegalArgumentException("combatant ids must be unique");
    }
    var bombIds = bombs.stream().map(BombView::id).distinct().count();
    if (bombIds != bombs.size()) {
      throw new IllegalArgumentException("bomb ids must be unique");
    }
  }

  public Optional<CombatantView> combatant(CombatantId id) {
    return combatants.stream().filter(view -> view.id().equals(id)).findFirst();
  }

  /** The combatant {@code id}, which must be in the snapshot. */
  public CombatantView require(CombatantId id) {
    return combatant(id)
        .orElseThrow(() -> new IllegalArgumentException(id + " is not in the snapshot"));
  }

  public Optional<BombView> bomb(BombId id) {
    return bombs.stream().filter(view -> view.id().equals(id)).findFirst();
  }

  /** Living members of {@code team}. */
  public List<CombatantView> alive(TeamId team) {
    return combatants.stream().filter(view -> view.alive() && view.team().equals(team)).toList();
  }

  /** Living combatants not on {@code team}. */
  public List<CombatantView> aliveEnemiesOf(TeamId team) {
    return combatants.stream().filter(view -> view.alive() && !view.team().equals(team)).toList();
  }

  /** Bombs whose explosion kills {@code team}. */
  public List<BombView> bombsOf(TeamId team) {
    return bombs.stream().filter(bomb -> bomb.belongsTo(team)).toList();
  }

  /** Bombs {@code team} may arm. */
  public List<BombView> bombsArmableBy(TeamId team) {
    return bombs.stream().filter(bomb -> bomb.armableBy(team)).toList();
  }

  /** Whether the match is in a phase where fighting matters. */
  public boolean isLive() {
    return matchPhase == MatchPhase.LIVE || matchPhase == MatchPhase.GRACE;
  }
}
