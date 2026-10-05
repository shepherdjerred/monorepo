package com.shepherdjerred.thestorm.mail.app;

import com.shepherdjerred.thestorm.core.result.Result;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;

/** Text letters have their own lifecycle and never alter item-delivery receipts. */
public interface Letters {
  record Letter(
      UUID id,
      UUID sender,
      String senderName,
      UUID recipient,
      String text,
      Instant sentAt,
      boolean read) {}

  record Limits(int maxLength, int intervalSeconds, int inboxLimit) {
    public Limits {
      if (maxLength < 1 || intervalSeconds < 1 || inboxLimit < 1)
        throw new IllegalArgumentException("invalid letter limits");
    }
  }

  CompletableFuture<Result<UUID, String>> send(Letter letter, Limits limits);

  CompletableFuture<List<Letter>> inbox(UUID recipient);

  CompletableFuture<Optional<Letter>> find(UUID recipient, UUID letter);

  CompletableFuture<Optional<Letter>> read(UUID recipient, UUID letter, Instant at);

  CompletableFuture<Boolean> delete(UUID recipient, UUID letter);
}
