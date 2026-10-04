package com.shepherdjerred.thestorm.companions.domain;

import java.time.LocalTime;
import java.time.ZoneId;
import java.util.List;
import java.util.stream.Collectors;

/** Strict, repository-owned survival configuration. No provider settings control gameplay. */
public record CompanionsConfig(
    int population,
    String timeZone,
    String opens,
    String closes,
    String spawnWorld,
    int thinkTicks,
    int scanRadius,
    int scanBlocksPerTick,
    int actionCooldownTicks,
    List<Identity> identities,
    String brainUrl) {
  public CompanionsConfig {
    ZoneId.of(timeZone);
    if (!LocalTime.parse(opens).isBefore(LocalTime.parse(closes)))
      throw new IllegalArgumentException("core hours must open before closing");
    identities = List.copyOf(identities);
    if (population < 1 || population > 3 || identities.size() != 3)
      throw new IllegalArgumentException("companions require three identities and population 1..3");
    if (identities.stream().map(Identity::id).collect(Collectors.toUnmodifiableSet()).size()
        != identities.size()) throw new IllegalArgumentException("duplicate companion identity");
    if (thinkTicks < 20
        || thinkTicks > 1200
        || scanRadius < 4
        || scanRadius > 16
        || scanBlocksPerTick < 1
        || scanBlocksPerTick > 256
        || actionCooldownTicks < 10
        || actionCooldownTicks > 200) throw new IllegalArgumentException("invalid gameplay limits");
    if (spawnWorld.isBlank() || brainUrl.isBlank())
      throw new IllegalArgumentException("world and brain URL are required");
  }

  public record Identity(String id, String name, String personality) {
    public Identity {
      if (!id.matches("[a-z][a-z0-9-]{0,31}")
          || !name.matches("[A-Za-z][A-Za-z0-9_]{0,15}")
          || personality.isBlank()
          || personality.length() > 500)
        throw new IllegalArgumentException("invalid companion identity");
    }
  }
}
