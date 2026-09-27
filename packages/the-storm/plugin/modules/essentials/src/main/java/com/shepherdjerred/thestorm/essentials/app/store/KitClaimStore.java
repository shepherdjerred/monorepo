package com.shepherdjerred.thestorm.essentials.app.store;

import com.shepherdjerred.thestorm.core.result.Result;
import com.shepherdjerred.thestorm.essentials.domain.kit.Kit;
import com.shepherdjerred.thestorm.essentials.domain.kit.KitError;
import com.shepherdjerred.thestorm.essentials.domain.kit.KitRules;
import java.time.Instant;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;

/** When players last claimed each kit. */
public interface KitClaimStore {

  /**
   * Claims a kit if {@link KitRules} allow it, recording the claim in the same transaction so two
   * claims cannot both succeed.
   */
  CompletableFuture<Result<Instant, KitError>> claim(UUID player, KitClaim claim);

  /**
   * A claim attempt.
   *
   * @param name the kit's name
   * @param kit the kit
   * @param at when
   */
  record KitClaim(String name, Kit kit, Instant at) {}
}
