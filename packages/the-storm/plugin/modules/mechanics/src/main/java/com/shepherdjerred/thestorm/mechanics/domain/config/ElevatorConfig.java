package com.shepherdjerred.thestorm.mechanics.domain.config;

/**
 * Sign elevators.
 *
 * @param access who may build and ride them
 * @param maxDistance how many blocks up or down the next floor may be
 */
public record ElevatorConfig(Access access, int maxDistance) {

  /** The full height of an overworld, so any floor in a column is reachable at most. */
  public static final int MAX_DISTANCE = 384;

  public ElevatorConfig {
    Checks.range("maxDistance", maxDistance, 2, MAX_DISTANCE);
  }
}
