package com.shepherdjerred.thestorm.quests.app;

import com.shepherdjerred.thestorm.core.result.Result;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;

/** Crystal and permission rewards. Futures complete off the main thread. */
public interface Rewards {

  /**
   * Pays {@code crystals} from the server account with {@code reason} in the ledger. Succeeds with
   * the amount in words ("750 crystals"), fails with why.
   */
  CompletableFuture<Result<String, String>> pay(UUID player, long crystals, String reason);

  /** Grants {@code permission} permanently. */
  CompletableFuture<Void> grant(UUID player, String permission);
}
