package com.shepherdjerred.thestorm.towns.app;

import java.time.InstantSource;
import java.util.concurrent.Executor;
import java.util.random.RandomGenerator;

/**
 * The runtime services the use cases need.
 *
 * @param time the current instant
 * @param random for new town ids
 * @param mainThread runs rollbacks on the main thread, where the state lives
 */
public record Clocks(InstantSource time, RandomGenerator random, Executor mainThread) {}
