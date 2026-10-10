package com.shepherdjerred.thestorm.rwf.app;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

/** Optional bot-module integration: main-thread observations for human demonstration recordings. */
public interface ObservationSource {
  record Sample(String contract, List<Double> values) {
    public Sample {
      values = List.copyOf(values);
    }
  }

  Optional<Sample> capture(UUID player);
}
