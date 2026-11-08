package com.shepherdjerred.thestorm.mechanics.domain.ic;

import java.util.HashMap;
import java.util.Map;
import java.util.Optional;

/** Named wireless states used by the historical MC1110 and MC1111 circuits. */
public final class WirelessBands {
  private final Map<String, Boolean> bands = new HashMap<>();

  /** MC1110 writes the input state and emits that same state on its output. */
  public boolean transmit(String band, boolean input) {
    bands.put(requireBand(band), input);
    return input;
  }

  /** MC1111 samples only on a rising trigger. An unseen band has no known state. */
  public Optional<Boolean> receive(String band, boolean previousInput, boolean input) {
    var name = requireBand(band);
    if (previousInput || !input) return Optional.empty();
    return Optional.of(bands.getOrDefault(name, false));
  }

  /** A self-triggered MC1111 samples the band without an external clock edge. */
  public Optional<Boolean> receiveSelfTriggered(String band) {
    return Optional.of(bands.getOrDefault(requireBand(band), false));
  }

  private static String requireBand(String band) {
    if (band.isBlank()) throw new IllegalArgumentException("wireless band must not be blank");
    return band;
  }
}
