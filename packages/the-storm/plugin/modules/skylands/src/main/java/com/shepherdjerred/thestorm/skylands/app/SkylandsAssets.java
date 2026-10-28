package com.shepherdjerred.thestorm.skylands.app;

import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.stream.Collectors;

/** Immutable native resource bytes prepared before the server thread starts. */
public final class SkylandsAssets {
  private final Map<String, byte[]> templates;

  public SkylandsAssets(Map<String, byte[]> templates) {
    this.templates =
        templates.entrySet().stream()
            .collect(Collectors.toUnmodifiableMap(Map.Entry::getKey, e -> e.getValue().clone()));
  }

  public Set<String> keys() {
    return templates.keySet();
  }

  public byte[] template(String key) {
    return Objects.requireNonNull(templates.get(key), "Missing native Skylands bytes " + key)
        .clone();
  }
}
