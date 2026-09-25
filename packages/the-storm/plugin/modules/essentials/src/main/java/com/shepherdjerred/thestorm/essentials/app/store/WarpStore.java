package com.shepherdjerred.thestorm.essentials.app.store;

import com.shepherdjerred.thestorm.essentials.domain.place.PlaceName;
import com.shepherdjerred.thestorm.essentials.domain.place.Warp;
import java.util.List;
import java.util.concurrent.CompletableFuture;

/** Server warps. */
public interface WarpStore {

  /** Every warp. */
  CompletableFuture<List<Warp>> all();

  /** Creates or moves a warp. */
  CompletableFuture<Void> save(Warp warp);

  /** Deletes a warp; false if it did not exist. */
  CompletableFuture<Boolean> delete(PlaceName name);
}
