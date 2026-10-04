package com.shepherdjerred.thestorm.towns.adapter.paper;

import com.shepherdjerred.thestorm.mail.app.Mail;
import com.shepherdjerred.thestorm.mail.app.MailItem;
import com.shepherdjerred.thestorm.shops.app.ShopRelocation;
import com.shepherdjerred.thestorm.towns.adapter.archive.AuxiliaryArchive;
import com.shepherdjerred.thestorm.towns.adapter.archive.ItemsArchive;
import com.shepherdjerred.thestorm.towns.adapter.archive.Schematics;
import com.shepherdjerred.thestorm.towns.app.RecoveryStore;
import com.shepherdjerred.thestorm.towns.domain.parcel.Blob;
import com.shepherdjerred.thestorm.towns.domain.parcel.Lease;
import com.shepherdjerred.thestorm.towns.domain.parcel.ParcelDefinition;
import com.shepherdjerred.thestorm.towns.domain.parcel.ParcelFingerprint;
import com.shepherdjerred.thestorm.towns.domain.parcel.ParcelKind;
import com.shepherdjerred.thestorm.towns.domain.parcel.PlotRecovery;
import com.shepherdjerred.thestorm.towns.domain.region.Cuboid;
import com.sk89q.worldedit.extent.clipboard.Clipboard;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.Executor;

/** Snapshot -> committed recovery -> baseline reset -> verified save -> mailbox. */
final class PlotResetting {
  private final PlotParts parts;
  private final Mail mail;
  private final PackedShops packed;
  private boolean reconciling;

  PlotResetting(PlotParts parts, Mail mail, PackedShops packed) {
    this.parts = parts;
    this.mail = mail;
    this.packed = packed;
  }

  CompletableFuture<String> reconcile() {
    if (reconciling) {
      return CompletableFuture.completedFuture("BUSY");
    }
    reconciling = true;
    return parts
        .rentals()
        .reconcile()
        .thenCompose(ignored -> parts.recoveries().unfinished())
        .thenComposeAsync(
            recoveries -> {
              CompletableFuture<Void> chain = CompletableFuture.completedFuture(null);
              for (var recovery : recoveries) {
                chain =
                    chain.thenComposeAsync(
                        ignored ->
                            switch (recovery.state()) {
                              case SNAPSHOT -> reset(recovery);
                              case AVAILABLE -> publish(recovery);
                              case PLACING -> packed.resume(recovery);
                              case ROLLING_BACK -> packed.rollback(recovery);
                              case PLACED, MATERIALS ->
                                  throw new IllegalStateException(
                                      "completed recovery in unfinished query");
                            },
                        main());
              }
              return chain.thenComposeAsync(ignored -> overdue(), main());
            },
            main())
        .whenCompleteAsync((result, failure) -> reconciling = false, main());
  }

  private CompletableFuture<String> overdue() {
    CompletableFuture<Void> chain = CompletableFuture.completedFuture(null);
    var due = new ArrayList<Lease>();
    for (var def : parts.parcels().definitions()) {
      parts
          .parcels()
          .lease(def.id())
          .filter(lease -> lease.reclaimable(parts.context().time().instant()))
          .ifPresent(due::add);
    }
    for (var lease : due) {
      chain = chain.thenComposeAsync(ignored -> snapshot(lease), main());
    }
    return chain.thenApplyAsync(
        ignored ->
            parts.parcels().definitions().stream()
                    .anyMatch(
                        def ->
                            parts
                                .parcels()
                                .lease(def.id())
                                .filter(
                                    lease -> lease.reclaimable(parts.context().time().instant()))
                                .isPresent())
                ? "BUSY"
                : "COMPLETE",
        main());
  }

  private CompletableFuture<Void> snapshot(Lease expected) {
    var current = parts.parcels().lease(expected.parcelId());
    if (current.isEmpty()
        || !current.get().equals(expected)
        || !current.get().reclaimable(parts.context().time().instant())
        || !parts.parcels().begin(expected.parcelId())) {
      return CompletableFuture.completedFuture(null);
    }
    var def = definition(expected.parcelId());
    var shops = parts.context().services().require(ShopRelocation.class);
    if (parts.lockService().isSettling() || !shops.idle(shopArea(def.area()))) {
      parts.parcels().end(def.id());
      return CompletableFuture.completedFuture(null);
    }
    var locks =
        parts.locks().all().stream()
            .filter(
                lock ->
                    lock.blocks().stream()
                        .anyMatch(
                            block ->
                                def.area()
                                    .contains(block.world(), block.x(), block.y(), block.z())))
            .toList();
    if (locks.stream()
        .anyMatch(
            lock ->
                !lock.owner().equals(expected.owner())
                    || lock.blocks().stream()
                        .anyMatch(
                            block ->
                                !def.area()
                                    .contains(block.world(), block.x(), block.y(), block.z())))) {
      return CompletableFuture.failedFuture(
          new IllegalStateException("lock ownership or bounds cross the plot"));
    }
    var auxiliary =
        new AuxiliaryArchive.Contents(
            1, shops.snapshot(shopArea(def.area()), expected.owner()), locks);
    var id = uuid();
    var token = uuid();
    return parts
        .world()
        .capture(def.area())
        .thenApplyAsync(
            captured ->
                new PlotRecovery(
                    id,
                    def.id(),
                    expected.owner(),
                    new Blob(Schematics.encode(captured.clipboard())),
                    new Blob(ItemsArchive.encode(captured.materials())),
                    new Blob(AuxiliaryArchive.encode(auxiliary)),
                    PlotRecovery.State.SNAPSHOT,
                    token,
                    Optional.empty()),
            parts.archives())
        .thenCompose(parts.recoveries()::snapshot)
        .thenComposeAsync(
            ignored -> {
              parts
                  .parcels()
                  .committed(
                      new Lease(
                          def.id(),
                          expected.owner(),
                          expected.paidThrough(),
                          Lease.State.RESETTING));
              return parts.recoveries().byId(id);
            },
            main())
        .thenComposeAsync(recovery -> reset(recovery.orElseThrow()), main());
  }

  private CompletableFuture<Void> reset(PlotRecovery recovery) {
    var def = definition(recovery.parcelId());
    parts.parcels().begin(def.id());
    var baseline = parts.baselines().get(def.id());
    if (baseline == null || !baseline.definitionHash().equals(ParcelFingerprint.of(def))) {
      return CompletableFuture.failedFuture(
          new IllegalStateException("plot baseline is missing or changed"));
    }
    return CompletableFuture.supplyAsync(
            () ->
                new ResetData(
                    Schematics.decode(baseline.schematic().bytes()),
                    AuxiliaryArchive.decode(recovery.auxiliary().bytes())),
            parts.archives())
        .thenComposeAsync(
            data -> {
              var shops = parts.context().services().require(ShopRelocation.class);
              if (parts.lockService().isSettling() || !shops.idle(shopArea(def.area()))) {
                return CompletableFuture.failedFuture(
                    new IllegalStateException("plot trades are still settling"));
              }
              return removeLocks(data.auxiliary())
                  .thenComposeAsync(ignored -> shops.remove(data.auxiliary().shops()), main())
                  .thenComposeAsync(
                      ignored -> {
                        parts.world().clearDecor(def.area());
                        return parts
                            .world()
                            .paste(
                                data.baseline(), def.area().world(), data.baseline().getOrigin());
                      },
                      main())
                  .thenComposeAsync(
                      ignored ->
                          parts
                              .world()
                              .verify(
                                  data.baseline(), def.area().world(), data.baseline().getOrigin()),
                      main())
                  .thenCompose(ignored -> parts.recoveries().resetComplete(recovery.id()))
                  .thenComposeAsync(
                      ignored -> {
                        parts.parcels().released(def.id());
                        parts.parcels().end(def.id());
                        return publish(recovery.withState(PlotRecovery.State.AVAILABLE));
                      },
                      main());
            },
            main());
  }

  private CompletableFuture<Void> removeLocks(AuxiliaryArchive.Contents auxiliary) {
    CompletableFuture<Void> chain = CompletableFuture.completedFuture(null);
    for (var lock : auxiliary.locks()) {
      chain =
          chain.thenComposeAsync(
              ignored -> {
                var current = parts.locks().byId(lock.id());
                if (current.isEmpty()) {
                  return CompletableFuture.completedFuture(null);
                }
                if (!current.get().equals(lock)) {
                  return CompletableFuture.failedFuture(
                      new IllegalStateException(
                          "archived lock changed during reset; staff reconciliation is required"));
                }
                return parts
                    .lockStore()
                    .delete(lock.id())
                    .thenRunAsync(() -> parts.locks().remove(lock.id()), main());
              },
              main());
    }
    return chain;
  }

  private CompletableFuture<Void> publish(PlotRecovery recovery) {
    return CompletableFuture.supplyAsync(
            () -> ItemsArchive.decode(recovery.materials().bytes()), parts.archives())
        .thenComposeAsync(
            items ->
                mail.postOnce(
                    new Mail.Message(
                        recovery.id(),
                        recovery.owner(),
                        "Recovered shop: " + recovery.parcelId(),
                        Map.of(
                            "materials",
                            items,
                            "packed",
                            List.of(new MailItem(packed.token(recovery).serializeAsBytes()))))),
            main())
        .thenCompose(ignored -> parts.recoveries().mailed(recovery.id()));
  }

  CompletableFuture<Void> baseline(String id) {
    var def = definition(id);
    if (def.kind() != ParcelKind.RENTAL_SHOP
        || parts.parcels().lease(id).isPresent()
        || parts.baselines().containsKey(id)
        || !parts.parcels().begin(id)) {
      return CompletableFuture.failedFuture(
          new IllegalArgumentException("only an unleased, unprepared rental may get a baseline"));
    }
    try {
      requireFoundation(def.area());
    } catch (RuntimeException failure) {
      parts.parcels().end(id);
      return CompletableFuture.failedFuture(failure);
    }
    return parts
        .world()
        .capture(def.area())
        .thenApplyAsync(
            captured -> {
              if (!captured.clipboard().getEntities().isEmpty()
                  || java.util.stream.StreamSupport.stream(
                          captured.clipboard().getRegion().spliterator(), false)
                      .anyMatch(
                          pos ->
                              !captured
                                  .clipboard()
                                  .getBlock(pos)
                                  .getBlockType()
                                  .getMaterial()
                                  .isAir())) {
                throw new IllegalStateException(
                    "rental building volume must be air; keep server ground, roads and infrastructure outside it");
              }
              return new RecoveryStore.Baseline(
                  id, ParcelFingerprint.of(def), new Blob(Schematics.encode(captured.clipboard())));
            },
            parts.archives())
        .thenCompose(
            saved ->
                parts
                    .recoveries()
                    .baseline(saved)
                    .thenRunAsync(
                        () -> {
                          parts.baselines().put(id, saved);
                          parts.parcels().baselineReady(id);
                        },
                        main()))
        .whenCompleteAsync((ignored, failure) -> parts.parcels().end(id), main());
  }

  private record ResetData(Clipboard baseline, AuxiliaryArchive.Contents auxiliary) {}

  private void requireFoundation(Cuboid area) {
    var world = parts.world().world(area.world());
    for (var x = area.from().x(); x <= area.to().x(); x++) {
      for (var z = area.from().z(); z <= area.to().z(); z++) {
        if (!world.getBlockAt(x, area.from().y() - 1, z).getType().isSolid()) {
          throw new IllegalArgumentException(
              "prepare a solid server-owned foundation directly below the entire rental first");
        }
      }
    }
  }

  private ParcelDefinition definition(String id) {
    return parts
        .parcels()
        .byId(id)
        .orElseThrow(() -> new IllegalArgumentException("no configured holding " + id));
  }

  private ShopRelocation.Area shopArea(Cuboid area) {
    return new ShopRelocation.Area(
        parts.world().world(area.world()).getUID(),
        area.from().x(),
        area.from().y(),
        area.from().z(),
        area.to().x(),
        area.to().y(),
        area.to().z());
  }

  private Executor main() {
    return parts.context().scheduler().mainThread();
  }

  private UUID uuid() {
    return new UUID(parts.context().random().nextLong(), parts.context().random().nextLong());
  }
}
