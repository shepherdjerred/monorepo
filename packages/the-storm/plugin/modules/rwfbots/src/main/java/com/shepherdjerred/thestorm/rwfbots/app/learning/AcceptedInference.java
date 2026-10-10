package com.shepherdjerred.thestorm.rwfbots.app.learning;

import java.util.concurrent.CompletableFuture;

/** A module-owned accepted Trooper actor, checked and warmed off the main thread. */
public interface AcceptedInference {
  CompletableFuture<BatchedInference> load();
}
