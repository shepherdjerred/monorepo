package com.shepherdjerred.thestorm.arena.app.store;

import com.shepherdjerred.thestorm.arena.domain.snapshot.ItemData;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;

/** Vault claims and the vault loot waiting to be handed out. */
public interface RewardStore {

  /**
   * Opens a milestone vault if {@code claim.player} has not opened that milestone on {@code
   * claim.day}: records the claim and queues the loot, atomically.
   */
  CompletableFuture<Claim> claimVault(VaultClaim claim);

  /**
   * Claims all the loot waiting for {@code player}, oldest first: returns it and removes it in one
   * transaction, so the same loot can never be handed out twice. Hand out only what this returns.
   */
  CompletableFuture<List<PendingReward>> claimAll(UUID player);

  /** Puts claimed loot back (the player went offline or into an arena before it was handed out). */
  CompletableFuture<Void> requeue(UUID player, List<PendingReward> rewards, Instant at);

  /** Whether a vault opened. */
  enum Claim {
    OPENED,
    ALREADY_OPENED,
  }

  /**
   * A request to open a milestone vault.
   *
   * @param player the player
   * @param wave the milestone wave
   * @param day the vault day it falls on
   * @param loot the rolled loot, serialized
   * @param at when
   */
  record VaultClaim(UUID player, int wave, LocalDate day, ItemData loot, Instant at) {}

  /**
   * Loot waiting to be handed out.
   *
   * @param id the row id it was stored under
   * @param reason why it was earned, such as {@code vault:wave20}
   * @param items the items, serialized
   */
  record PendingReward(long id, String reason, ItemData items) {}
}
