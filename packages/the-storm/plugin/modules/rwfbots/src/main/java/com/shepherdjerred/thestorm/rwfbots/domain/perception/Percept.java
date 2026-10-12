package com.shepherdjerred.thestorm.rwfbots.domain.perception;

import com.shepherdjerred.thestorm.rwfbots.domain.world.CombatantId;
import com.shepherdjerred.thestorm.rwfbots.domain.world.CombatantView;
import java.util.List;
import java.util.Optional;

/**
 * The result of one perception tick.
 *
 * @param state the memory and suspicion to carry forward
 * @param visible enemies seen this tick, nearest first
 * @param tick the tick perceived
 */
public record Percept(PerceptionState state, List<CombatantView> visible, long tick) {

  public Percept {
    visible = List.copyOf(visible);
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
