package com.shepherdjerred.thestorm.chat.app;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.shepherdjerred.thestorm.chat.adapter.db.JooqIdentityStore;
import com.shepherdjerred.thestorm.chat.domain.Identity;
import com.shepherdjerred.thestorm.core.db.StormDatabase;
import java.nio.file.Path;
import java.time.Instant;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

final class IdentityServiceTest {
  @TempDir Path directory;
  private final UUID first = UUID.randomUUID();
  private final UUID second = UUID.randomUUID();
  private final IdentityStore.Audit audit = new IdentityStore.Audit(first, Instant.EPOCH, "nick");

  @Test
  void nicknameUniquenessAndPreferencesSurviveRestartWithAtomicAudit() {
    var path = directory.resolve("identities.db");
    try (var db = StormDatabase.open(path)) {
      db.migrate("chat", getClass().getClassLoader());
      var service = new IdentityService(new JooqIdentityStore(db));
      service.load().join();
      service.change(first, identity -> identity.named(Optional.of("Thunder")), audit).join();
      service.change(first, Identity::toggleMessages, audit).join();
      assertThat(service.effective(first)).isEqualTo(Identity.fresh());
      assertThat(service.activelyNamed("Thunder")).isEmpty();
      service.displaying(first, true);
      assertThat(service.effective(first).nickname()).contains("Thunder");
      assertThat(service.activelyNamed("thunder")).contains(first);
      assertThat(service.effective(first).messages()).isFalse();
      service.displaying(first, false);
      assertThat(service.effective(first)).isEqualTo(Identity.fresh());
      assertThat(service.named("Thunder")).contains(first);
      assertThat(service.activelyNamed("Thunder")).isEmpty();
      assertThatThrownBy(
              () ->
                  service
                      .change(second, identity -> identity.named(Optional.of("thunder")), audit)
                      .join())
          .isInstanceOf(java.util.concurrent.CompletionException.class);
      assertThat(service.identity(second)).isEqualTo(Identity.fresh());
      int count =
          db.read(
                  sql ->
                      sql.fetchCount(
                          com.shepherdjerred.thestorm.chat.adapter.db.generated.Tables
                              .CHAT_IDENTITY_AUDIT))
              .join();
      assertThat(count).isEqualTo(2);
    }
    try (var db = StormDatabase.open(path)) {
      db.migrate("chat", getClass().getClassLoader());
      var service = new IdentityService(new JooqIdentityStore(db));
      service.load().join();
      assertThat(service.display(first, "Alice")).isEqualTo("Thunder");
      assertThat(service.identity(first).messages()).isFalse();
      assertThat(service.named("THUNDER")).contains(first);
    }
  }

  @Test
  void failedStoreWriteNeverPublishesNickname() {
    var service =
        new IdentityService(
            new IdentityStore() {
              @Override
              public CompletableFuture<Map<UUID, Identity>> load() {
                return CompletableFuture.completedFuture(Map.of());
              }

              @Override
              public CompletableFuture<Void> save(UUID player, Identity identity, Audit audit) {
                return CompletableFuture.failedFuture(new IllegalStateException("disk full"));
              }
            });
    service.load().join();
    assertThatThrownBy(
            () ->
                service
                    .change(first, identity -> identity.named(Optional.of("Thunder")), audit)
                    .join())
        .hasRootCauseMessage("disk full");
    assertThat(service.identity(first)).isEqualTo(Identity.fresh());
  }

  @Test
  void clearingDisplayStateOnQuitStopsOfflineNicknameLookup() {
    var service =
        new IdentityService(
            new IdentityStore() {
              @Override
              public CompletableFuture<Map<UUID, Identity>> load() {
                return CompletableFuture.completedFuture(Map.of());
              }

              @Override
              public CompletableFuture<Void> save(UUID player, Identity identity, Audit audit) {
                return CompletableFuture.completedFuture(null);
              }
            });
    service.load().join();
    service.change(first, identity -> identity.named(Optional.of("Thunder")), audit).join();
    service.displaying(first, true);
    assertThat(service.activelyNamed("Thunder")).contains(first);

    service.displaying(first, false);

    assertThat(service.activelyNamed("Thunder")).isEmpty();
  }

  @Test
  void namesCannotCarryFormattingOrStaffTitles() {
    for (var name : java.util.List.of("Admin", "<red>Staff", "x", "too_long_a_username"))
      assertThatThrownBy(() -> Identity.fresh().named(Optional.of(name)))
          .isInstanceOf(IllegalArgumentException.class);
  }
}
