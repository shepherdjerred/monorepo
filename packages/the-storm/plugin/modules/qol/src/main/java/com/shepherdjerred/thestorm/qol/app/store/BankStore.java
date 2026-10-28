package com.shepherdjerred.thestorm.qol.app.store;

import com.shepherdjerred.thestorm.qol.domain.bank.StoredBank;
import java.util.List;
import java.util.concurrent.CompletableFuture;

/** Deposit banks. Futures complete off the main thread. */
public interface BankStore {

  CompletableFuture<List<StoredBank>> loadAll();

  /** Writes {@code bank}, replacing any previous row with the same id, including its shelves. */
  CompletableFuture<Void> save(StoredBank bank);

  CompletableFuture<Void> delete(String id);
}
