package com.shepherdjerred.thestorm.shops.app;

import com.shepherdjerred.thestorm.shops.domain.shop.BlockPos;
import java.util.Collection;
import java.util.HashSet;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CompletionException;
import java.util.concurrent.Executor;
import java.util.function.Consumer;

/**
 * Trades waiting on the ledger. A trade locks every block of its shop's container (both halves of a
 * double chest, shared by every sign on it) and its customer, so two trades never race for the same
 * stock or room, and the guards keep the container frozen (no opening, hoppers or breaking) until
 * it settles. Main thread only.
 */
public final class ShopLocks {

  private final Set<BlockPos> containers = new HashSet<>();
  private final Set<UUID> customers = new HashSet<>();
  private final Set<Lease> held = new LinkedHashSet<>();

  /** A held lock; release it exactly once when the trade settles. */
  public final class Lease {
    private final List<BlockPos> blocks;
    private final UUID customer;
    private final Deal deal;
    private boolean released;

    private Lease(List<BlockPos> blocks, UUID customer, Deal deal) {
      this.blocks = blocks;
      this.customer = customer;
      this.deal = deal;
    }

    /** The trade this lease guards, for journaling one that never settles. */
    public Deal deal() {
      return deal;
    }

    /**
     * Once {@code trade} ends, on {@code mainThread}: runs {@code onCompleted} for a completed
     * trade (journaling, counting), then releases this lease, so the next trade on the same
     * container or customer sees everything this one did. A failed trade still releases.
     */
    public CompletableFuture<TradeOutcome> releaseAfter(
        CompletableFuture<TradeOutcome> trade,
        Consumer<TradeOutcome.Completed> onCompleted,
        Executor mainThread) {
      return trade.handleAsync(
          (outcome, error) -> {
            try {
              if (error == null && outcome instanceof TradeOutcome.Completed completed) {
                onCompleted.accept(completed);
              }
            } finally {
              release();
            }
            if (error != null) {
              throw error instanceof CompletionException wrapped
                  ? wrapped
                  : new CompletionException(error);
            }
            return outcome;
          },
          mainThread);
    }

    /**
     * Frees the container and customer. Releasing twice does nothing: a trade the shutdown drain
     * gave up on may still finish afterwards.
     */
    public void release() {
      if (released) {
        return;
      }
      released = true;
      blocks.forEach(containers::remove);
      customers.remove(customer);
      held.remove(this);
    }
  }

  /**
   * Locks the container blocks and the customer for {@code deal}, or returns empty if any of them
   * is already busy.
   */
  public Optional<Lease> acquire(Collection<BlockPos> blocks, UUID customer, Deal deal) {
    if (customers.contains(customer) || blocks.stream().anyMatch(containers::contains)) {
      return Optional.empty();
    }
    var lease = new Lease(List.copyOf(blocks), customer, deal);
    customers.add(customer);
    containers.addAll(lease.blocks);
    held.add(lease);
    return Optional.of(lease);
  }

  /** Whether a trade has locked this container block. */
  public boolean isBusy(BlockPos block) {
    return containers.contains(block);
  }

  /** Whether any trade is in flight. */
  public boolean idle() {
    return held.isEmpty();
  }

  /** Every lease still held. */
  public List<Lease> held() {
    return List.copyOf(held);
  }
}
