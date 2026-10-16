package com.shepherdjerred.thestorm.core.safety;

import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.function.BiFunction;

/** Content is not published before check completes. Evidence failures fail publication closed. */
public interface ContentSafety {
  CompletableFuture<ContentReview> check(ContentSubmission submission);

  CompletableFuture<Void> finish(UUID submission, String outcome);

  CompletableFuture<Void> observe(ContentSubmission submission, String outcome);

  CompletableFuture<Void> overturn(UUID submission, UUID staff);

  void penalties(java.util.function.Function<ContentPenalty, CompletableFuture<Void>> handler);

  void reviews(BiFunction<ContentSubmission, ContentReview, CompletableFuture<Void>> handler);

  void commandRoutes(BiFunction<UUID, String, String> routes);

  String command(UUID player, String original);

  void audiences(BiFunction<UUID, String, String> provider);

  String audience(UUID player, String text);

  void mutes(java.util.function.Function<UUID, CompletableFuture<Boolean>> muted);

  void evidenceContext(String key, java.util.function.Function<UUID, String> provider);

  java.util.Map<String, String> evidenceContext(UUID player);
}
