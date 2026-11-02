package com.shepherdjerred.thestorm.core.players;

import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.core.module.Services;
import java.time.Instant;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import org.junit.jupiter.api.Test;

/** Account names win, and a stored nickname resolves when the account name does not. */
final class NickDirectoryTest {

  @Test
  void anAccountNameWinsOverANickname() {
    var steve = new KnownPlayer(UUID.randomUUID(), "Steve", Instant.EPOCH);
    var directory = new NickDirectory(accounts(steve), services(UUID.randomUUID()));

    assertThat(directory.byName("steve").join()).contains(steve);
  }

  @Test
  void aNicknameResolvesToTheAccount() {
    var owner = UUID.randomUUID();
    var linc = new KnownPlayer(owner, "Lincbuggy", Instant.EPOCH);
    var directory = new NickDirectory(accounts(linc), services(owner));

    assertThat(directory.byName("kawaii").join()).contains(linc);
  }

  private static PlayerDirectory accounts(KnownPlayer player) {
    return new PlayerDirectory() {
      @Override
      public CompletableFuture<Optional<KnownPlayer>> byName(String name) {
        return CompletableFuture.completedFuture(
            player.lastName().equalsIgnoreCase(name) ? Optional.of(player) : Optional.empty());
      }

      @Override
      public CompletableFuture<Optional<KnownPlayer>> byId(UUID uuid) {
        return CompletableFuture.completedFuture(
            player.uuid().equals(uuid) ? Optional.of(player) : Optional.empty());
      }
    };
  }

  private static Services services(UUID nickOwner) {
    var services = new Services();
    services.provide(
        Nicknames.class,
        new Nicknames() {
          @Override
          public Optional<UUID> named(String nickname) {
            return nickname.equalsIgnoreCase("kawaii") ? Optional.of(nickOwner) : Optional.empty();
          }

          @Override
          public String display(UUID player, String accountName) {
            return player.equals(nickOwner) ? "kawaii" : accountName;
          }
        });
    return services;
  }
}
