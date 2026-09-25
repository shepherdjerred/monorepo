package com.shepherdjerred.thestorm.towns.app;

import java.util.concurrent.CompletableFuture;

/**
 * A change already applied in memory, and its write to storage. If the write fails the change has
 * been rolled back in memory by the time {@code saved} completes exceptionally.
 *
 * @param value what changed
 * @param saved completes once storage has the change
 */
public record Change<T>(T value, CompletableFuture<Void> saved) {}
