package com.shepherdjerred.thestorm.rwfbots.app;

/**
 * How often the think layers run, in server ticks, at governor level 0. Perception runs the most
 * often, tactics a few times a second and the team step once or twice a second; the governor
 * doubles every period under load.
 *
 * @param perceptionEveryTicks ticks between perception passes per bot (2 is 10 Hz)
 * @param tacticsEveryTicks ticks between think steps per bot (5 is 4 Hz)
 * @param teamEveryTicks ticks between team steps per team (10 to 20 is 2 to 1 Hz)
 * @param maxDecisionAgeTicks a decision decided from a snapshot older than this is stale
 * @param losRayBudget the most line-of-sight rays one think job casts before deferring bots
 */
public record ThinkRates(
    int perceptionEveryTicks,
    int tacticsEveryTicks,
    int teamEveryTicks,
    int maxDecisionAgeTicks,
    int losRayBudget) {

  public ThinkRates {
    if (perceptionEveryTicks < 1 || tacticsEveryTicks < 1 || teamEveryTicks < 1) {
      throw new IllegalArgumentException("think periods must be at least one tick");
    }
    if (maxDecisionAgeTicks < 1) {
      throw new IllegalArgumentException("max decision age must be at least one tick");
    }
    if (losRayBudget < 1) {
      throw new IllegalArgumentException("the ray budget must be positive");
    }
  }
}
