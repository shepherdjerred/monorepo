package com.shepherdjerred.thestorm.rwf.app;

import java.util.Optional;

/** Preflight shared by ordinary and seeded showcase starts, before either changes the lobby. */
public record ShowcaseStart(
    int maximum, boolean ready, boolean hasRoster, boolean running, int humans, boolean lobby) {

  public Optional<String> refusal(int count) {
    if (count < 2 || count > maximum) {
      return Optional.of("Showcase size is outside the configured bounds.");
    }
    if (!ready) {
      return Optional.of("The match is still being prepared; try again in a moment.");
    }
    if (!hasRoster) {
      return Optional.of("No bot roster is provided; enable the rwfbots module.");
    }
    if (running) {
      return Optional.of("A showcase is already running.");
    }
    if (humans > 0) {
      return Optional.of("Players are in the match; a showcase needs a lobby without them.");
    }
    if (!lobby) {
      return Optional.of("A match is under way; start the showcase from the next lobby.");
    }
    return Optional.empty();
  }
}
