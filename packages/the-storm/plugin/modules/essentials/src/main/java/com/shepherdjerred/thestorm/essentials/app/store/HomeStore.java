package com.shepherdjerred.thestorm.essentials.app.store;

import com.shepherdjerred.thestorm.core.result.Result;
import com.shepherdjerred.thestorm.essentials.domain.home.Home;
import com.shepherdjerred.thestorm.essentials.domain.home.HomeError;
import com.shepherdjerred.thestorm.essentials.domain.home.HomeRules;
import com.shepherdjerred.thestorm.essentials.domain.place.PlaceName;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;

/** Players' homes. */
public interface HomeStore {

  /** {@code player}'s homes, by name. */
  CompletableFuture<List<Home>> homes(UUID player);

  /** Sets {@code home}, checking the limit against the stored homes in the same transaction. */
  CompletableFuture<Result<HomeRules.Change, HomeError>> set(UUID player, Home home, int limit);

  /** Deletes a home; false if it did not exist. */
  CompletableFuture<Boolean> delete(UUID player, PlaceName name);
}
