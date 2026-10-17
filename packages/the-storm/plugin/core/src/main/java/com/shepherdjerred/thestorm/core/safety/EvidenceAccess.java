package com.shepherdjerred.thestorm.core.safety;

import java.util.concurrent.CompletableFuture;

/** Private structured queries; callers never route evidence through console or public logs. */
public interface EvidenceAccess {
  CompletableFuture<String> query(String request, String accessor);
}
