package com.shepherdjerred.thestorm.mechanics.domain.ic;

import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Optional;
import java.util.function.Predicate;

/** Named wireless states used by the historical MC1110 and MC1111 circuits. */
public final class WirelessBands<S> {
  private final Map<String, LinkedHashMap<S, Boolean>> bands = new HashMap<>();
  private final Map<S, String> sources = new HashMap<>();

  /** MC1110 writes the input state and emits that same state on its output. */
  public boolean transmit(String band, S source, boolean input) {
    var name = requireBand(band);
    forget(source);
    bands.computeIfAbsent(name, ignored -> new LinkedHashMap<>()).put(source, input);
    sources.put(source, name);
    return input;
  }

  /** Removed or unloaded transmitters cannot leave an unowned signal behind. */
  public void forget(S source) {
    var band = sources.remove(source);
    if (band == null) return;
    var states = bands.get(band);
    if (states != null) {
      states.remove(source);
      if (states.isEmpty()) bands.remove(band);
    }
  }

  /** MC1111 samples only on a rising trigger. An unseen band has no known state. */
  public Optional<Boolean> receive(
      String band, boolean previousInput, boolean input, Predicate<S> permitted) {
    var name = requireBand(band);
    if (previousInput || !input) return Optional.empty();
    return receiveSelfTriggered(name, permitted);
  }

  /** A self-triggered MC1111 samples the band without an external clock edge. */
  public Optional<Boolean> receiveSelfTriggered(String band, Predicate<S> permitted) {
    var states = bands.get(requireBand(band));
    if (states == null) return Optional.of(false);
    for (var state : states.reversed().entrySet())
      if (permitted.test(state.getKey())) return Optional.of(state.getValue());
    return Optional.of(false);
  }

  private static String requireBand(String band) {
    if (band.isBlank()) throw new IllegalArgumentException("wireless band must not be blank");
    return band;
  }
}
