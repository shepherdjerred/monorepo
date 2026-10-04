package com.shepherdjerred.thestorm.towns.adapter.paper;

import static java.nio.charset.StandardCharsets.UTF_8;

import com.shepherdjerred.thestorm.mail.app.Mail;
import com.shepherdjerred.thestorm.mail.app.MailItem;
import com.shepherdjerred.thestorm.shops.app.ShopRelocation;
import com.shepherdjerred.thestorm.towns.adapter.archive.AuxiliaryArchive;
import com.shepherdjerred.thestorm.towns.adapter.archive.Schematics;
import com.shepherdjerred.thestorm.towns.domain.land.BlockPos;
import com.shepherdjerred.thestorm.towns.domain.lock.Lock;
import com.shepherdjerred.thestorm.towns.domain.parcel.Blob;
import com.shepherdjerred.thestorm.towns.domain.parcel.PlotRecovery;
import com.shepherdjerred.thestorm.towns.domain.protection.Act;
import com.shepherdjerred.thestorm.towns.domain.protection.Action;
import com.shepherdjerred.thestorm.towns.domain.protection.Actor;
import com.shepherdjerred.thestorm.towns.domain.protection.Subject;
import com.shepherdjerred.thestorm.towns.domain.region.AdminRegion;
import com.shepherdjerred.thestorm.towns.domain.region.BlockCorner;
import com.shepherdjerred.thestorm.towns.domain.region.Cuboid;
import com.shepherdjerred.thestorm.towns.domain.region.RegionAreas;
import com.shepherdjerred.thestorm.towns.domain.region.RegionProfile;
import com.shepherdjerred.thestorm.towns.domain.region.RegionSpawns;
import com.sk89q.worldedit.extent.clipboard.Clipboard;
import com.sk89q.worldedit.math.BlockVector3;
import java.time.Duration;
import java.time.Instant;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.Executor;
import net.kyori.adventure.text.Component;
import org.bukkit.Material;
import org.bukkit.NamespacedKey;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.player.PlayerInteractEvent;
import org.bukkit.inventory.ItemStack;
import org.bukkit.persistence.PersistentDataType;

/** An owner-bound token refers to a server archive; placement is journaled before world writes. */
final class PackedShops implements Listener {
  private final PlotParts parts;
  private final Mail mail;
  private final Guard guard;
  private final NamespacedKey recoveryKey;
  private final NamespacedKey tokenKey;
  private final Map<UUID, Preview> previews = new HashMap<>();
  private final HashSet<UUID> busy = new HashSet<>();
  private final HashSet<UUID> writing = new HashSet<>();

  private record Data(Clipboard clipboard, AuxiliaryArchive.Contents auxiliary) {}

  private record Preview(
      PlotRecovery recovery, Data data, PlotRecovery.Destination destination, Instant expires) {}

  PackedShops(PlotParts parts, Mail mail, Guard guard) {
    this.parts = parts;
    this.mail = mail;
    this.guard = guard;
    recoveryKey = new NamespacedKey(parts.context().plugin(), "packed_shop");
    tokenKey = new NamespacedKey(parts.context().plugin(), "packed_shop_token");
  }

  ItemStack token(PlotRecovery recovery) {
    var item = new ItemStack(Material.CHEST);
    item.editMeta(
        meta -> {
          meta.displayName(Component.text("Packed shop: " + recovery.parcelId()));
          meta.lore(
              List.of(
                  Component.text("Right-click a block to preview your shop."),
                  Component.text("Then /plot confirm or /plot cancel."),
                  Component.text("Only the original owner can unpack this.")));
          meta.getPersistentDataContainer()
              .set(recoveryKey, PersistentDataType.STRING, recovery.id().toString());
          meta.getPersistentDataContainer()
              .set(tokenKey, PersistentDataType.STRING, recovery.token().toString());
        });
    return item;
  }

  @EventHandler(priority = EventPriority.LOWEST)
  void onInteract(PlayerInteractEvent event) {
    var item = event.getItem();
    if (item == null || !item.hasItemMeta()) {
      return;
    }
    var data = item.getItemMeta().getPersistentDataContainer();
    var id = data.get(recoveryKey, PersistentDataType.STRING);
    if (id == null) {
      return;
    }
    event.setCancelled(true);
    var clicked = event.getClickedBlock();
    if (event.getAction() != org.bukkit.event.block.Action.RIGHT_CLICK_BLOCK || clicked == null) {
      return;
    }
    var player = event.getPlayer();
    var token = data.get(tokenKey, PersistentDataType.STRING);
    if (token == null || !busy.add(player.getUniqueId())) {
      return;
    }
    var origin = clicked.getRelative(event.getBlockFace());
    var world = origin.getWorld().getName();
    var anchor = BlockVector3.at(origin.getX(), origin.getY(), origin.getZ());
    var future =
        parts
            .recoveries()
            .byId(UUID.fromString(id))
            .thenComposeAsync(
                saved -> {
                  var recovery =
                      saved.orElseThrow(
                          () -> new IllegalArgumentException("this packed shop no longer exists"));
                  requireOwner(recovery, player.getUniqueId(), UUID.fromString(token));
                  return selected(recovery).thenCompose(ignored -> decode(recovery));
                },
                main())
            .thenComposeAsync(
                saved -> {
                  var size = saved.clipboard().getDimensions();
                  var destination =
                      new PlotRecovery.Destination(
                          world, anchor.x(), anchor.y(), anchor.z(), size.x(), size.y(), size.z());
                  var recovery = new TokenReference(UUID.fromString(id), UUID.fromString(token));
                  // Read the authoritative token again at confirmation; a preview grants no world
                  // rights.
                  return preview(player, recovery, saved, destination);
                },
                main());
    finish(player, future, "Preview ready. Use /plot confirm within 60 seconds, or /plot cancel.");
  }

  private record TokenReference(UUID id, UUID token) {}

  private CompletableFuture<Void> preview(
      Player player, TokenReference reference, Data data, PlotRecovery.Destination destination) {
    checkEmpty(player.getUniqueId(), destination);
    return parts
        .recoveries()
        .byId(reference.id())
        .thenAcceptAsync(
            saved -> {
              var recovery = saved.orElseThrow();
              requireOwner(recovery, player.getUniqueId(), reference.token());
              previews.put(
                  player.getUniqueId(),
                  new Preview(
                      recovery,
                      data,
                      destination,
                      parts.context().time().instant().plus(Duration.ofSeconds(60))));
              player.sendMessage(
                  Notices.info(
                      "Shop volume: "
                          + destination.width()
                          + " × "
                          + destination.height()
                          + " × "
                          + destination.depth()
                          + " blocks at "
                          + destination.x()
                          + ", "
                          + destination.y()
                          + ", "
                          + destination.z()));
              var box = area(destination);
              for (var x : List.of(box.from().x(), box.to().x() + 1)) {
                for (var y : List.of(box.from().y(), box.to().y() + 1)) {
                  for (var z : List.of(box.from().z(), box.to().z() + 1)) {
                    player.spawnParticle(
                        org.bukkit.Particle.END_ROD,
                        new org.bukkit.Location(parts.world().world(destination.world()), x, y, z),
                        8);
                  }
                }
              }
            },
            main());
  }

  CompletableFuture<Void> confirm(Player player) {
    var preview = previews.remove(player.getUniqueId());
    if (preview == null || !parts.context().time().instant().isBefore(preview.expires())) {
      return CompletableFuture.failedFuture(
          new IllegalArgumentException(
              "preview missing or expired; right-click your packed shop again"));
    }
    checkEmpty(player.getUniqueId(), preview.destination());
    parts
        .context()
        .services()
        .require(ShopRelocation.class)
        .validateRestore(player.getUniqueId(), preview.data().auxiliary().shops());
    if (parts.lockService().isSettling()
        || parts.locks().countOf(player.getUniqueId()) + preview.data().auxiliary().locks().size()
            > parts.lockService().policy().maxPerPlayer()) {
      throw new IllegalArgumentException(
          "your container locks are settling or exceed the current lock limit");
    }
    var recovery = preview.recovery();
    reserve(recovery.id(), preview.destination());
    return parts
        .recoveries()
        .byId(recovery.id())
        .thenComposeAsync(
            current -> {
              requireOwner(current.orElseThrow(), player.getUniqueId(), recovery.token());
              return selected(recovery);
            },
            main())
        .thenComposeAsync(ignored -> parts.world().capture(area(preview.destination())), main())
        .thenApplyAsync(before -> new Blob(Schematics.encode(before.clipboard())), parts.archives())
        .thenCompose(
            before ->
                parts
                    .recoveries()
                    .placing(
                        new com.shepherdjerred.thestorm.towns.app.RecoveryStore.Placement(
                            recovery.id(),
                            recovery.owner(),
                            recovery.token(),
                            preview.destination(),
                            before)))
        .thenComposeAsync(ignored -> parts.recoveries().byId(recovery.id()), main())
        .thenComposeAsync(current -> resume(current.orElseThrow()), main())
        .whenCompleteAsync(
            (ignored, failure) -> {
              if (failure != null) {
                var _ =
                    parts
                        .recoveries()
                        .byId(recovery.id())
                        .thenAcceptAsync(
                            saved -> {
                              if (saved.isPresent()
                                  && saved.get().state() == PlotRecovery.State.AVAILABLE) {
                                parts.state().endWork(workId(recovery.id()));
                              }
                            },
                            main());
              }
            },
            main());
  }

  void cancel(UUID owner) {
    previews.remove(owner);
  }

  void reserve(UUID id, PlotRecovery.Destination destination) {
    parts
        .state()
        .beginWork(
            new AdminRegion(
                workId(id),
                "Shop placement in progress",
                new RegionAreas(List.of(), List.of(area(destination))),
                List.of(),
                new RegionSpawns(true, java.util.Set.of()),
                RegionProfile.PRESERVE));
  }

  CompletableFuture<Void> resume(PlotRecovery recovery) {
    return exclusive(recovery.id(), () -> resumeData(recovery));
  }

  private CompletableFuture<Void> resumeData(PlotRecovery recovery) {
    if (recovery.state() != PlotRecovery.State.PLACING) {
      return CompletableFuture.failedFuture(
          new IllegalArgumentException("recovery has no placement journal"));
    }
    var destination = recovery.destination().orElseThrow();
    reserve(recovery.id(), destination);
    return decode(recovery)
        .thenComposeAsync(
            data -> {
              var dimensions = data.clipboard().getDimensions();
              if (dimensions.x() != destination.width()
                  || dimensions.y() != destination.height()
                  || dimensions.z() != destination.depth()) {
                throw new IllegalStateException(
                    "placement journal and saved schematic bounds disagree");
              }
              var area = area(destination);
              for (var pos : PlotWorld.region(area)) {
                requirePermission(recovery.owner(), recovery.id(), destination.world(), pos);
              }
              parts.world().clearDecor(area);
              var origin = BlockVector3.at(destination.x(), destination.y(), destination.z());
              var offset = origin.subtract(data.clipboard().getOrigin());
              return parts
                  .world()
                  .paste(
                      data.clipboard(),
                      destination.world(),
                      origin,
                      pos -> permission(recovery.owner(), recovery.id(), destination.world(), pos))
                  .thenComposeAsync(
                      ignored ->
                          parts.world().verify(data.clipboard(), destination.world(), origin),
                      main())
                  .thenComposeAsync(
                      ignored -> restoreLocks(data.auxiliary(), destination.world(), offset),
                      main())
                  .thenComposeAsync(
                      ignored ->
                          parts
                              .context()
                              .services()
                              .require(ShopRelocation.class)
                              .restore(
                                  data.auxiliary().shops(),
                                  new ShopRelocation.Target(
                                      parts.world().world(destination.world()).getUID(),
                                      offset.x(),
                                      offset.y(),
                                      offset.z())),
                      main())
                  .thenRunAsync(() -> parts.world().checkpoint(destination.world()), main())
                  .thenCompose(ignored -> parts.recoveries().placed(recovery.id()))
                  .thenRunAsync(() -> parts.state().endWork(workId(recovery.id())), main());
            },
            main());
  }

  CompletableFuture<Void> rollback(UUID id) {
    return exclusive(
        id,
        () ->
            parts
                .recoveries()
                .rollingBack(id)
                .thenCompose(ignored -> parts.recoveries().byId(id))
                .thenComposeAsync(saved -> rollbackData(saved.orElseThrow()), main()));
  }

  CompletableFuture<Void> rollback(PlotRecovery recovery) {
    return exclusive(recovery.id(), () -> rollbackData(recovery));
  }

  private CompletableFuture<Void> rollbackData(PlotRecovery recovery) {
    if (recovery.state() != PlotRecovery.State.ROLLING_BACK) {
      return CompletableFuture.failedFuture(
          new IllegalStateException("rollback has no durable journal"));
    }
    var destination = recovery.destination().orElseThrow();
    reserve(recovery.id(), destination);
    return parts
        .recoveries()
        .before(recovery.id())
        .thenCombineAsync(
            decode(recovery),
            (before, data) -> {
              var clipboard = Schematics.decode(before.bytes());
              var size = clipboard.getDimensions();
              if (size.x() != destination.width()
                  || size.y() != destination.height()
                  || size.z() != destination.depth()
                  || !clipboard.getEntities().isEmpty()
                  || java.util.stream.StreamSupport.stream(
                          clipboard.getRegion().spliterator(), false)
                      .anyMatch(
                          pos -> !clipboard.getBlock(pos).getBlockType().getMaterial().isAir())) {
                throw new IllegalStateException(
                    "rollback preimage is not the validated empty destination");
              }
              return new RollbackData(clipboard, data);
            },
            parts.archives())
        .thenComposeAsync(
            saved -> {
              var origin = BlockVector3.at(destination.x(), destination.y(), destination.z());
              var offset = origin.subtract(saved.data().clipboard().getOrigin());
              var target =
                  new ShopRelocation.Target(
                      parts.world().world(destination.world()).getUID(),
                      offset.x(),
                      offset.y(),
                      offset.z());
              return parts
                  .context()
                  .services()
                  .require(ShopRelocation.class)
                  .removePlaced(saved.data().auxiliary().shops(), target)
                  .thenComposeAsync(
                      ignored ->
                          removePlacedLocks(saved.data().auxiliary(), destination.world(), offset),
                      main())
                  .thenComposeAsync(
                      ignored -> {
                        parts.world().clearDecor(area(destination));
                        return parts.world().paste(saved.before(), destination.world(), origin);
                      },
                      main())
                  .thenComposeAsync(
                      ignored -> parts.world().verify(saved.before(), destination.world(), origin),
                      main())
                  .thenRunAsync(() -> parts.world().checkpoint(destination.world()), main())
                  .thenCompose(ignored -> parts.recoveries().rolledBack(recovery.id()))
                  .thenRunAsync(() -> parts.state().endWork(workId(recovery.id())), main());
            },
            main());
  }

  private record RollbackData(Clipboard before, Data data) {}

  private CompletableFuture<Void> removePlacedLocks(
      AuxiliaryArchive.Contents data, String world, BlockVector3 offset) {
    CompletableFuture<Void> chain = CompletableFuture.completedFuture(null);
    for (var saved : data.locks()) {
      var moved = translated(saved, world, offset);
      chain =
          chain.thenComposeAsync(
              ignored -> {
                var current = parts.locks().byId(saved.id());
                if (current.isPresent() && !current.get().equals(moved)) {
                  throw new IllegalStateException(
                      "lock changed during placement; rollback requires staff reconciliation");
                }
                if (current.isEmpty()) {
                  return CompletableFuture.completedFuture(null);
                }
                return parts
                    .lockStore()
                    .delete(saved.id())
                    .thenRunAsync(() -> parts.locks().remove(saved.id()), main());
              },
              main());
    }
    return chain;
  }

  private CompletableFuture<Void> exclusive(
      UUID id, java.util.function.Supplier<CompletableFuture<Void>> action) {
    if (!writing.add(id)) {
      return CompletableFuture.failedFuture(
          new IllegalArgumentException("this shop placement is still settling"));
    }
    try {
      return action.get().whenCompleteAsync((ignored, failure) -> writing.remove(id), main());
    } catch (RuntimeException failure) {
      writing.remove(id);
      throw failure;
    }
  }

  CompletableFuture<Void> reissue(UUID owner, UUID id) {
    return parts
        .recoveries()
        .byId(id)
        .thenComposeAsync(
            saved -> {
              var recovery =
                  saved.orElseThrow(
                      () -> new IllegalArgumentException("no recovered shop with this id"));
              requireOwner(recovery, owner, recovery.token());
              return selected(recovery)
                  .thenComposeAsync(
                      ignored -> {
                        var next = replacementToken(recovery.id(), recovery.token());
                        var replacement =
                            new PlotRecovery(
                                recovery.id(),
                                recovery.parcelId(),
                                owner,
                                recovery.schematic(),
                                recovery.materials(),
                                recovery.auxiliary(),
                                recovery.state(),
                                next,
                                recovery.destination());
                        return mail.postOnce(
                                new Mail.Message(
                                    next,
                                    owner,
                                    "Replacement packed shop: " + recovery.parcelId(),
                                    Map.of(
                                        "packed",
                                        List.of(
                                            new MailItem(token(replacement).serializeAsBytes())))))
                            .thenCompose(
                                posted ->
                                    parts.recoveries().reissue(id, owner, recovery.token(), next));
                      },
                      main());
            },
            main());
  }

  static UUID replacementToken(UUID recoveryId, UUID previousToken) {
    return UUID.nameUUIDFromBytes(
        ("the-storm:packed-shop-reissue:" + recoveryId + ":" + previousToken).getBytes(UTF_8));
  }

  private CompletableFuture<Void> restoreLocks(
      AuxiliaryArchive.Contents data, String world, BlockVector3 offset) {
    CompletableFuture<Void> chain = CompletableFuture.completedFuture(null);
    for (var saved : data.locks()) {
      var moved = translated(saved, world, offset);
      chain =
          chain.thenComposeAsync(
              ignored -> {
                var existing = parts.locks().byId(moved.id());
                if (existing.isPresent() && !existing.get().equals(moved)) {
                  throw new IllegalStateException("recovered lock id is already used elsewhere");
                }
                return parts
                    .lockStore()
                    .save(moved)
                    .thenRunAsync(() -> parts.locks().put(moved), main());
              },
              main());
    }
    return chain;
  }

  private void checkEmpty(UUID owner, PlotRecovery.Destination destination) {
    var world = parts.world().world(destination.world());
    var area = area(destination);
    if (area.from().y() < world.getMinHeight() || area.to().y() >= world.getMaxHeight()) {
      throw new IllegalArgumentException("shop does not fit within world height");
    }
    for (var pos : PlotWorld.region(area)) {
      requirePermission(owner, new UUID(0, 0), destination.world(), pos);
      var block = world.getBlockAt(pos.x(), pos.y(), pos.z());
      if (!block.getType().isAir()
          || parts.locks().at(destination.world(), pos.x(), pos.y(), pos.z()) != null
          || !world.getWorldBorder().isInside(block.getLocation())) {
        throw new IllegalArgumentException(
            "shop needs empty, buildable space throughout its full volume");
      }
    }
    var box =
        new org.bukkit.util.BoundingBox(
            area.from().x(),
            area.from().y(),
            area.from().z(),
            area.to().x() + 1.0,
            area.to().y() + 1.0,
            area.to().z() + 1.0);
    if (!world.getNearbyEntities(box).isEmpty()) {
      throw new IllegalArgumentException(
          "move players, animals and decorations out of the shop volume");
    }
  }

  private static Lock translated(Lock saved, String world, BlockVector3 offset) {
    var blocks = new HashSet<BlockPos>();
    for (var block : saved.blocks()) {
      blocks.add(
          new BlockPos(
              world,
              Math.addExact(block.x(), offset.x()),
              Math.addExact(block.y(), offset.y()),
              Math.addExact(block.z(), offset.z())));
    }
    return new Lock(saved.id(), saved.owner(), blocks, saved.trusted(), saved.options());
  }

  private boolean permission(UUID owner, UUID recovery, String world, BlockVector3 pos) {
    var land =
        parts
            .state()
            .landAtExceptWork(workId(recovery), new BlockPos(world, pos.x(), pos.y(), pos.z()));
    return guard
        .engine()
        .decide(Actor.player(owner), new Act(Action.BUILD, Subject.BLOCK), land)
        .isAllowed();
  }

  private void requirePermission(UUID owner, UUID recovery, String world, BlockVector3 pos) {
    if (!permission(owner, recovery, world, pos)) {
      throw new IllegalArgumentException("you cannot build throughout the shop volume");
    }
  }

  private CompletableFuture<Void> selected(PlotRecovery recovery) {
    return mail.selection(recovery.id(), recovery.owner())
        .thenAccept(
            choice -> {
              if (!choice.equals(Optional.of("packed"))) {
                throw new IllegalArgumentException("claim the packed option from /mail first");
              }
            });
  }

  private static void requireOwner(PlotRecovery recovery, UUID owner, UUID token) {
    if (!recovery.owner().equals(owner)
        || !recovery.token().equals(token)
        || recovery.state() != PlotRecovery.State.AVAILABLE) {
      throw new IllegalArgumentException(
          "this packed shop belongs to someone else, was replaced, or was already used");
    }
  }

  private CompletableFuture<Data> decode(PlotRecovery recovery) {
    return CompletableFuture.supplyAsync(
        () ->
            new Data(
                Schematics.decode(recovery.schematic().bytes()),
                AuxiliaryArchive.decode(recovery.auxiliary().bytes())),
        parts.archives());
  }

  private void finish(Player player, CompletableFuture<Void> future, String success) {
    var _ =
        future.whenCompleteAsync(
            (ignored, failure) -> {
              busy.remove(player.getUniqueId());
              if (failure == null) {
                player.sendMessage(Notices.info(success));
              } else {
                parts.context().logger().warn("Packed shop operation failed", failure);
                player.sendMessage(
                    Notices.error(
                        "Packed shop operation failed. Your archive is retained; "
                            + "staff can reconcile a pending placement."));
              }
            },
            main());
  }

  static Cuboid area(PlotRecovery.Destination destination) {
    return new Cuboid(
        destination.world(),
        new BlockCorner(destination.x(), destination.y(), destination.z()),
        new BlockCorner(
            Math.addExact(destination.x(), destination.width() - 1),
            Math.addExact(destination.y(), destination.height() - 1),
            Math.addExact(destination.z(), destination.depth() - 1)));
  }

  private static String workId(UUID id) {
    return "unpack_" + id.toString().replace("-", "").substring(0, 24);
  }

  private Executor main() {
    return parts.context().scheduler().mainThread();
  }
}
