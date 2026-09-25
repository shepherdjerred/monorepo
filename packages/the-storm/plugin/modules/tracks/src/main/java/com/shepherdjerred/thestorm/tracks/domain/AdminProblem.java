package com.shepherdjerred.thestorm.tracks.domain;

import com.shepherdjerred.thestorm.tracks.app.Track;

/** Why an administrator's level change was refused. */
public sealed interface AdminProblem {

  /** Setting secondary {@code track} to {@code level} would pass the primary. */
  record AbovePrimary(Track track, int level, Track primary, int primaryLevel)
      implements AdminProblem {}

  /** Lowering the primary to {@code level} would leave {@code secondary} above it. */
  record BelowSecondary(Track primary, int level, Track secondary, int secondaryLevel)
      implements AdminProblem {}

  /**
   * Removing the primary while other tracks remain would change the primary, which only a reset may
   * do.
   */
  record WouldChangePrimary(Track primary) implements AdminProblem {}
}
