package com.shepherdjerred.thestorm.core.players;

import com.shepherdjerred.thestorm.core.module.Services;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;

/**
 * Account names first, then a stored nickname. Nicknames come from chat, which may enable after
 * this directory is published, so the lookup happens when a command asks.
 */
public final class NickDirectory implements PlayerDirectory {

  private final PlayerDirectory accounts;
  private final Services services;

  public NickDirectory(PlayerDirectory accounts, Services services) {
    this.accounts = accounts;
    this.services = services;
  }

  @Override
  public CompletableFuture<Optional<KnownPlayer>> byName(String name) {
    return accounts
        .byName(name)
        .thenCompose(found -> {
          if (found.isPresent()) {
            return CompletableFuture.completedFuture(found);
          }
          var nick = services.find(Nicknames.class).flatMap(nicknames -> nicknames.named(name));
          if (nick.isEmpty()) {
            return CompletableFuture.completedFuture(Optional.empty());
          }
          return accounts.byId(nick.orElseThrow());
        });
  }

  @Override
  public CompletableFuture<Optional<KnownPlayer>> byId(UUID uuid) {
    return accounts.byId(uuid);
  }
}
