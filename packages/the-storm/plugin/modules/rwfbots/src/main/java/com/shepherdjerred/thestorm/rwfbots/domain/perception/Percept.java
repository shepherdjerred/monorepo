package com.shepherdjerred.thestorm.rwfbots.domain.perception;

import com.shepherdjerred.thestorm.rwfbots.domain.world.CombatantId;
import com.shepherdjerred.thestorm.rwfbots.domain.world.CombatantView;
import com.shepherdjerred.thestorm.rwfbots.domain.world.SummonView;
import java.util.List;
import java.util.Optional;

/**
 * The result of one perception tick.
 *
 * @param state the memory and suspicion to carry forward
 * @param visible enemies seen this tick, nearest first
 * @param tick the tick perceived
 * @param summons hostile killstreak creatures seen this tick, nearest first
 */
public record Percept(
    PerceptionState state, List<CombatantView> visible, long tick, List<SummonView> summons) {

  public Percept {
    visible = List.copyOf(visible);
    summons = List.copyOf(summons);
  }

  /** A percept with no summons in sight. */
  public Percept(PerceptionState state, List<CombatantView> visible, long tick) {
    this(state, visible, tick, List.of());
  }

  /** The hostile summon seen this tick with {@code id}, if any. */
  public Optional<SummonView> summon(CombatantId id) {
    return summons.stream().filter(view -> view.id().equals(id)).findFirst();
  }

  public Optional<CombatantView> nearestVisible() {
    return visible.isEmpty() ? Optional.empty() : Optional.of(visible.getFirst());
  }

  public Optional<CombatantView> visible(CombatantId id) {
    return visible.stream().filter(view -> view.id().equals(id)).findFirst();
  }

  public boolean sees(CombatantId id) {
    return visible(id).isPresent();
  }

  /** Enemies remembered at {@code tauTicks} decay but not currently seen. */
  public List<CombatantId> rememberedOnly(double tauTicks) {
    return state.memory().sightings().keySet().stream()
        .filter(id -> !sees(id))
        .filter(id -> state.memory().confidence(id, tick, tauTicks) >= Memory.FORGET_BELOW)
        .sorted()
        .toList();
  }
}
