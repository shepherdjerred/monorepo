package com.shepherdjerred.thestorm.mail.app;

import com.shepherdjerred.thestorm.core.result.Result;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;

/** Non-expiring mailbox; one exclusive option, delivered in resumable inventory-sized batches. */
public interface Mail {
  record Message(UUID id, UUID owner, String title, Map<String, List<MailItem>> options) {
    public Message {
      options =
          options.entrySet().stream()
              .collect(
                  java.util.stream.Collectors.toUnmodifiableMap(
                      Map.Entry::getKey, entry -> List.copyOf(entry.getValue())));
      if (title.isBlank()
          || options.isEmpty()
          || options.size() > 8
          || options.keySet().stream().anyMatch(key -> !key.matches("[a-z]{1,16}"))) {
        throw new IllegalArgumentException("mail needs a title and named options");
      }
    }
  }

  record Summary(UUID id, String title, List<String> options, String selected, int remaining) {
    public Summary {
      options = List.copyOf(options);
    }
  }

  record Batch(UUID token, UUID messageId, UUID owner, List<MailItem> items) {
    public Batch {
      items = List.copyOf(items);
    }
  }

  /** Same id and payload is a retry; differing payload under the id is an internal error. */
  CompletableFuture<Void> postOnce(Message message);

  CompletableFuture<List<Summary>> list(UUID owner);

  CompletableFuture<Optional<String>> selection(UUID messageId, UUID owner);

  record Claim(UUID messageId, UUID owner, String option, int capacity, UUID token) {}

  CompletableFuture<Result<Batch, String>> reserve(Claim claim);

  /** The caller saved both items and the token to player.dat before acknowledging. */
  CompletableFuture<Void> acknowledge(UUID owner, UUID token);
}
