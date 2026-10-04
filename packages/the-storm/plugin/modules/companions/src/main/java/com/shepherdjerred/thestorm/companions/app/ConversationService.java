package com.shepherdjerred.thestorm.companions.app;

import com.shepherdjerred.thestorm.companions.domain.CompanionsConfig.Identity;
import java.util.Optional;
import java.util.concurrent.CompletableFuture;

/** Chat text only. No game action or planner instruction can cross this boundary. */
@FunctionalInterface
public interface ConversationService extends AutoCloseable {
  CompletableFuture<Optional<String>> reply(Identity identity, String message, String context);

  @Override
  default void close() {}
}
