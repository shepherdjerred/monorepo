package com.shepherdjerred.thestorm.qol.adapter.db;

import static com.shepherdjerred.thestorm.qol.adapter.db.generated.Tables.QOL_BANK;
import static com.shepherdjerred.thestorm.qol.adapter.db.generated.Tables.QOL_BANK_GRANT;
import static com.shepherdjerred.thestorm.qol.adapter.db.generated.Tables.QOL_SHELF;
import static com.shepherdjerred.thestorm.qol.adapter.db.generated.Tables.QOL_SHELF_MATERIAL;

import com.shepherdjerred.thestorm.core.db.StormDatabase;
import com.shepherdjerred.thestorm.qol.app.store.BankStore;
import com.shepherdjerred.thestorm.qol.domain.bank.BankRole;
import com.shepherdjerred.thestorm.qol.domain.bank.StoredBank;
import com.shepherdjerred.thestorm.qol.domain.bank.StoredBank.Spot;
import com.shepherdjerred.thestorm.qol.domain.bank.StoredBank.StoredShelf;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import org.jooq.DSLContext;

/** Banks, their grants and their shelves. */
public final class JooqBankStore implements BankStore {

  private final StormDatabase database;

  public JooqBankStore(StormDatabase database) {
    this.database = database;
  }

  @Override
  public CompletableFuture<List<StoredBank>> loadAll() {
    return database.read(this::readAll);
  }

  @Override
  public CompletableFuture<Void> save(StoredBank bank) {
    return done(dsl -> writeBank(dsl, bank));
  }

  @Override
  public CompletableFuture<Void> delete(String id) {
    return done(dsl -> dsl.deleteFrom(QOL_BANK).where(QOL_BANK.ID.eq(id)).execute());
  }

  private CompletableFuture<Void> done(java.util.function.Consumer<DSLContext> work) {
    return database
        .write(
            dsl -> {
              work.accept(dsl);
              return Boolean.TRUE;
            })
        .thenAccept(ignored -> {});
  }

  private List<StoredBank> readAll(DSLContext dsl) {
    var grants = new HashMap<String, HashMap<UUID, BankRole>>();
    dsl.selectFrom(QOL_BANK_GRANT)
        .forEach(
            row ->
                grants
                    .computeIfAbsent(row.getBank(), id -> new HashMap<>())
                    .put(UUID.fromString(row.getPlayer()), BankRole.valueOf(row.getRole())));
    var materials = new HashMap<String, HashSet<String>>();
    dsl.selectFrom(QOL_SHELF_MATERIAL)
        .forEach(
            row ->
                materials
                    .computeIfAbsent(row.getShelf(), id -> new HashSet<>())
                    .add(row.getMaterial()));
    var shelves = new HashMap<String, List<StoredShelf>>();
    dsl.selectFrom(QOL_SHELF)
        .orderBy(QOL_SHELF.ID)
        .forEach(
            row ->
                shelves
                    .computeIfAbsent(row.getBank(), id -> new ArrayList<>())
                    .add(
                        new StoredShelf(
                            row.getId(),
                            new Spot(
                                row.getWorld(), row.getSignX(), row.getSignY(), row.getSignZ()),
                            new Spot(
                                row.getWorld(),
                                row.getContainerX(),
                                row.getContainerY(),
                                row.getContainerZ()),
                            row.getRestack() != 0,
                            materials.getOrDefault(row.getId(), new HashSet<>()))));
    return dsl.selectFrom(QOL_BANK)
        .orderBy(QOL_BANK.ID)
        .fetch(
            row ->
                new StoredBank(
                    row.getId(),
                    UUID.fromString(row.getOwner()),
                    new Spot(row.getWorld(), row.getSignX(), row.getSignY(), row.getSignZ()),
                    new Spot(
                        row.getWorld(),
                        row.getContainerX(),
                        row.getContainerY(),
                        row.getContainerZ()),
                    grants.getOrDefault(row.getId(), new HashMap<>()),
                    shelves.getOrDefault(row.getId(), List.of())));
  }

  private static void writeBank(DSLContext dsl, StoredBank bank) {
    dsl.deleteFrom(QOL_BANK).where(QOL_BANK.ID.eq(bank.id())).execute();
    var sign = bank.sign();
    var container = bank.container();
    dsl.insertInto(QOL_BANK)
        .set(QOL_BANK.ID, bank.id())
        .set(QOL_BANK.OWNER, bank.owner().toString())
        .set(QOL_BANK.WORLD, sign.world())
        .set(QOL_BANK.SIGN_X, sign.x())
        .set(QOL_BANK.SIGN_Y, sign.y())
        .set(QOL_BANK.SIGN_Z, sign.z())
        .set(QOL_BANK.CONTAINER_X, container.x())
        .set(QOL_BANK.CONTAINER_Y, container.y())
        .set(QOL_BANK.CONTAINER_Z, container.z())
        .execute();
    for (var grant : bank.grants().entrySet()) {
      dsl.insertInto(QOL_BANK_GRANT)
          .set(QOL_BANK_GRANT.BANK, bank.id())
          .set(QOL_BANK_GRANT.PLAYER, grant.getKey().toString())
          .set(QOL_BANK_GRANT.ROLE, grant.getValue().name())
          .execute();
    }
    for (var shelf : bank.shelves()) {
      var shelfSign = shelf.sign();
      var shelfContainer = shelf.container();
      dsl.insertInto(QOL_SHELF)
          .set(QOL_SHELF.ID, shelf.id())
          .set(QOL_SHELF.BANK, bank.id())
          .set(QOL_SHELF.WORLD, shelfSign.world())
          .set(QOL_SHELF.SIGN_X, shelfSign.x())
          .set(QOL_SHELF.SIGN_Y, shelfSign.y())
          .set(QOL_SHELF.SIGN_Z, shelfSign.z())
          .set(QOL_SHELF.CONTAINER_X, shelfContainer.x())
          .set(QOL_SHELF.CONTAINER_Y, shelfContainer.y())
          .set(QOL_SHELF.CONTAINER_Z, shelfContainer.z())
          .set(QOL_SHELF.RESTACK, shelf.restack() ? 1 : 0)
          .execute();
      for (var material : shelf.materials()) {
        dsl.insertInto(QOL_SHELF_MATERIAL)
            .set(QOL_SHELF_MATERIAL.SHELF, shelf.id())
            .set(QOL_SHELF_MATERIAL.MATERIAL, material)
            .execute();
      }
    }
  }
}
