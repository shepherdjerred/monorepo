package com.shepherdjerred.thestorm.rwfbots.domain.world;

import com.shepherdjerred.thestorm.rwfbots.domain.geom.Vec3;
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
 * @param looseArrows arrows lying in the ground near a combatant whose shots spend arrows, which
 *     anyone walking over may pick up; capped by the capture, nearest such combatant first
 */
public record WorldSnapshot(
    long tick,
    MatchPhase matchPhase,
    List<CombatantView> combatants,
    List<BombView> bombs,
    PoisonView poison,
    String mapId,
    List<Stimulus> stimuli,
    List<Vec3> looseArrows) {

  public WorldSnapshot {
    if (tick < 0) {
      throw new IllegalArgumentException("tick must not be negative");
    }
    if (mapId.isBlank()) {
      throw new IllegalArgumentException("map id must not be blank");
    }
    combatants = combatants instanceof CombatantList ? combatants : new CombatantList(combatants);
    bombs = List.copyOf(bombs);
    stimuli = List.copyOf(stimuli);
    looseArrows = List.copyOf(looseArrows);
    for (var index = 1; index < stimuli.size(); index++) {
      if (stimuli.get(index).sequence() < stimuli.get(index - 1).sequence())
        throw new IllegalArgumentException("sound history must be ordered by sequence");
    }
    var bombIds = bombs.stream().map(BombView::id).distinct().count();
    if (bombIds != bombs.size()) {
      throw new IllegalArgumentException("bomb ids must be unique");
    }
  }

  public Optional<CombatantView> combatant(CombatantId id) {
    // The canonical constructor always installs an immutable indexed list, retaining the
    // public list order and record value semantics without scanning every bot for each lookup.
    return ((CombatantList) combatants).find(id);
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

  /** Finds new sounds without rescanning the retained events already consumed by this bot. */
  public List<Stimulus> stimuliAfter(long sequence) {
    var low = 0;
    var high = stimuli.size();
    while (low < high) {
      var middle = (low + high) >>> 1;
      if (stimuli.get(middle).sequence() <= sequence) low = middle + 1;
      else high = middle;
    }
    return stimuli.subList(low, stimuli.size());
  }
}
