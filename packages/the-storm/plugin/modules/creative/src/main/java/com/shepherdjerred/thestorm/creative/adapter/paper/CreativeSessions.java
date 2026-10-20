package com.shepherdjerred.thestorm.creative.adapter.paper;

import com.mojang.brigadier.Command;
import com.shepherdjerred.thestorm.arena.app.ArenaPresence;
import com.shepherdjerred.thestorm.core.module.ModuleContext;
import com.shepherdjerred.thestorm.core.players.Humans;
import com.shepherdjerred.thestorm.core.snapshot.PlayerStates;
import com.shepherdjerred.thestorm.core.snapshot.SavedPlayerData;
import com.shepherdjerred.thestorm.core.text.HouseStyle;
import com.shepherdjerred.thestorm.core.world.SealedWorlds;
import com.shepherdjerred.thestorm.creative.app.BodyStore;
import com.shepherdjerred.thestorm.creative.app.BodySwap;
import com.shepherdjerred.thestorm.creative.app.VisitBody;
import com.shepherdjerred.thestorm.creative.app.VisitBook;
import com.shepherdjerred.thestorm.creative.domain.BodyRole;
import java.util.HashSet;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import net.kyori.adventure.text.Component;
import org.bukkit.GameMode;
import org.bukkit.World;
import org.bukkit.entity.Player;
import org.jspecify.annotations.Nullable;

/**
 * The sealed creative visit. Main thread only. Entering stores the survival body before the player
 * is emptied; leaving puts that body back and discards creative experience, effects and items. A
 * crash while inside resumes the creative body and leaves the survival row in place.
 */
public final class CreativeSessions {

  private static final String LABEL = "Creative";

  private final ModuleContext context;
  private final BodyStore store;
  private final World world;
  private final SavedPlayerData saved;
  private final SealedWorlds sealed;
  private final CreativeMarker marker;
  private final Set<UUID> opening = new HashSet<>();
  private final Set<UUID> closing = new HashSet<>();
  private final Set<UUID> crossing = new HashSet<>();
  private final Set<UUID> restoreOnRespawn = new HashSet<>();
  private final Set<UUID> creativeDeaths = new HashSet<>();
  private VisitBook book = VisitBook.EMPTY;

  /**
   * What a session needs.
   *
   * @param context module services, clock and scheduler
   * @param store stored bodies
   * @param world the creative world
   * @param saved player data used to prove a restore
   */
  public record Parts(ModuleContext context, BodyStore store, World world, SavedPlayerData saved) {}

  public CreativeSessions(Parts parts) {
    this.context = parts.context();
    this.store = parts.store();
    this.world = parts.world();
    this.saved = parts.saved();
    this.sealed = context.services().require(SealedWorlds.class);
    this.marker = new CreativeMarker(context.plugin());
  }

  /** Recovers players who were already online when the module enabled. */
  public void recoverOnline() {
    for (var player : context.plugin().getServer().getOnlinePlayers()) {
      joined(player);
    }
  }

  /** Saves in-session creative bodies. The survival rows stay until a later login proves them. */
  public void shutdown() {
    for (var player : context.plugin().getServer().getOnlinePlayers()) {
      quit(player);
    }
  }

  public int enter(Player player) {
    if (!Humans.isHuman(player)) {
      return Command.SINGLE_SUCCESS;
    }
    var verdict = BodySwap.enter(attempt(player));
    if (verdict != BodySwap.Verdict.OPEN_AT_SPAWN && verdict != BodySwap.Verdict.OPEN_HERE) {
      error(player, refusal(verdict));
      return Command.SINGLE_SUCCESS;
    }
    if (!PlayerStates.settle(player)) {
      error(player, "Free a slot so the item on your cursor can be stored.");
      return Command.SINGLE_SUCCESS;
    }
    var id = player.getUniqueId();
    if (!opening.add(id)) {
      error(player, refusal(BodySwap.Verdict.BUSY));
      return Command.SINGLE_SUCCESS;
    }
    var survival = CreativeBodies.capture(player, BodyRole.SURVIVAL, context.time().instant());
    book = book.hold(survival);
    CreativeBodies.openFresh(player);
    if (verdict == BodySwap.Verdict.OPEN_AT_SPAWN) {
      cross(id, () -> player.teleport(CreativeBodies.spawn(world)));
    }
    onSaved(player, survival);
    return Command.SINGLE_SUCCESS;
  }

  public int leave(Player player) {
    if (!Humans.isHuman(player)) {
      return Command.SINGLE_SUCCESS;
    }
    var id = player.getUniqueId();
    var survival = book.survival(id);
    if (busy(id)) {
      error(player, refusal(BodySwap.Verdict.BUSY));
      return Command.SINGLE_SUCCESS;
    }
    if (survival.isEmpty() || !inCreative(player)) {
      error(player, "You are not in creative.");
      return Command.SINGLE_SUCCESS;
    }
    if (player.isDead()) {
      error(player, "Respawn before leaving creative.");
      return Command.SINGLE_SUCCESS;
    }
    var destination = returningWorld(survival.orElseThrow());
    if (destination == null) {
      error(player, "The world you came from is not loaded, so you stay in creative.");
      return Command.SINGLE_SUCCESS;
    }
    closing.add(id);
    PlayerStates.discardHeld(player);
    var creative = CreativeBodies.capture(player, BodyRole.CREATIVE, context.time().instant());
    var returning = BodySwap.restored(survival.orElseThrow(), creative);
    cross(id, () -> CreativeBodies.apply(player, returning, context.plugin().getServer()));
    marker.record(player, returning);
    success(player, "Your survival belongings are back.");
    onDiscarded(player, returning);
    return Command.SINGLE_SUCCESS;
  }

  public void joined(Player player) {
    if (!Humans.isHuman(player)) {
      return;
    }
    var id = player.getUniqueId();
    listen(
        store.load(id),
        "read the creative visit of " + player.getName(),
        bodies -> arrived(player, bodies));
  }

  public void quit(Player player) {
    var id = player.getUniqueId();
    if (book.inside(id) && inCreative(player) && !player.isDead()) {
      logFailure(
          store.save(CreativeBodies.capture(player, BodyRole.CREATIVE, context.time().instant())),
          "save the creative body of " + player.getName());
    }
    book = book.drop(id);
    opening.remove(id);
    closing.remove(id);
    crossing.remove(id);
    creativeDeaths.remove(id);
    restoreOnRespawn.remove(id);
  }

  /** Saves the creative body when a player dies inside an open visit. */
  public void died(Player player) {
    if (!inCreative(player)) {
      return;
    }
    var id = player.getUniqueId();
    creativeDeaths.add(id);
    if (!book.inside(id)) {
      return;
    }
    logFailure(
        store.save(CreativeBodies.capture(player, BodyRole.CREATIVE, context.time().instant())),
        "save the creative body of " + player.getName());
  }

  public boolean diedInCreative(UUID player) {
    return creativeDeaths.remove(player);
  }

  /** Applies a survival restore that waited for the player to respawn. */
  public void respawned(Player player) {
    if (!restoreOnRespawn.remove(player.getUniqueId())) {
      return;
    }
    book.survival(player.getUniqueId()).ifPresent(body -> putBack(player, body));
  }

  public boolean allowsCross(UUID player) {
    return crossing.contains(player);
  }

  private void arrived(Player player, List<VisitBody> bodies) {
    if (!player.isOnline() || book.inside(player.getUniqueId())) {
      return;
    }
    var survival = role(bodies, BodyRole.SURVIVAL);
    var creative = role(bodies, BodyRole.CREATIVE);
    switch (BodySwap.onJoin(inCreative(player), survival.isPresent())) {
      case NONE -> {}
      case RESUME -> resume(player, survival.orElseThrow(), creative);
      case RESTORE -> restore(player, survival.orElseThrow());
    }
  }

  private void resume(Player player, VisitBody survival, Optional<VisitBody> creative) {
    book = book.hold(survival);
    if (creative.isPresent()) {
      cross(
          player.getUniqueId(),
          () -> CreativeBodies.apply(player, creative.orElseThrow(), context.plugin().getServer()));
      return;
    }
    player.setGameMode(GameMode.CREATIVE);
    player.setAllowFlight(true);
    player.setFlySpeed(0.1f);
  }

  private void restore(Player player, VisitBody survival) {
    book = book.hold(survival);
    if (marker.matches(player, survival)) {
      retire(player);
      return;
    }
    if (player.isDead()) {
      restoreOnRespawn.add(player.getUniqueId());
      return;
    }
    putBack(player, survival);
  }

  private void putBack(Player player, VisitBody survival) {
    cross(
        player.getUniqueId(),
        () -> CreativeBodies.apply(player, survival, context.plugin().getServer()));
    marker.record(player, survival);
    prove(player, survival);
  }

  private void onSaved(Player player, VisitBody survival) {
    var _ =
        store
            .save(survival)
            .whenCompleteAsync(
                (stored, failure) -> {
                  if (failure != null) {
                    context
                        .logger()
                        .error(
                            "Could not store the survival body of {}", player.getName(), failure);
                    guarded("returning " + player.getName(), () -> openedFailed(player, survival));
                    return;
                  }
                  guarded("welcoming " + player.getName(), () -> opened(player));
                },
                context.scheduler().mainThread());
  }

  private void opened(Player player) {
    opening.remove(player.getUniqueId());
    if (!player.isOnline() || !book.inside(player.getUniqueId())) {
      return;
    }
    success(player, "You are in creative. Nothing you pick up here comes back.");
  }

  private void onDiscarded(Player player, VisitBody returning) {
    var _ =
        store
            .delete(player.getUniqueId(), BodyRole.CREATIVE)
            .whenCompleteAsync(
                (deleted, failure) -> {
                  if (failure != null) {
                    context
                        .logger()
                        .error(
                            "Could not discard the creative body of {}", player.getName(), failure);
                  }
                  guarded(
                      "proving the restore of " + player.getName(), () -> prove(player, returning));
                },
                context.scheduler().mainThread());
  }

  private void prove(Player player, VisitBody survival) {
    if (!saved.available() || !player.isOnline()) {
      closing.remove(player.getUniqueId());
      return;
    }
    var _ =
        saved
            .save(player)
            .whenCompleteAsync(
                (written, failure) -> {
                  if (failure != null) {
                    context
                        .logger()
                        .error("Could not save the restored body of {}", player.getName(), failure);
                    closing.remove(player.getUniqueId());
                    return;
                  }
                  guarded(
                      "reading the restore proof of " + player.getName(),
                      () -> readProof(player, survival));
                },
                context.scheduler().mainThread());
  }

  private void readProof(Player player, VisitBody survival) {
    var id = player.getUniqueId();
    var _ =
        saved
            .marker(id, marker.key())
            .whenCompleteAsync(
                (found, failure) ->
                    guarded(
                        "checking the restore proof of " + player.getName(),
                        () ->
                            checked(
                                player,
                                survival,
                                failure == null && found != null ? found : Optional.empty())),
                context.scheduler().mainThread());
  }

  private void checked(Player player, VisitBody survival, Optional<String> found) {
    if (found.equals(Optional.of(CreativeMarker.fingerprint(survival)))) {
      retire(player);
      return;
    }
    closing.remove(player.getUniqueId());
  }

  private void retire(Player player) {
    var id = player.getUniqueId();
    book = book.drop(id);
    closing.remove(id);
    logFailure(store.delete(id), "retire the creative visit of " + player.getName());
  }

  private @Nullable World returningWorld(VisitBody survival) {
    return context.plugin().getServer().getWorld(survival.snapshot().position().world());
  }

  private void openedFailed(Player player, VisitBody survival) {
    opening.remove(player.getUniqueId());
    book = book.drop(player.getUniqueId());
    if (!player.isOnline()) {
      return;
    }
    cross(
        player.getUniqueId(),
        () -> CreativeBodies.apply(player, survival, context.plugin().getServer()));
    error(player, "Creative could not save your belongings, so they were returned.");
  }

  private BodySwap.Attempt attempt(Player player) {
    var id = player.getUniqueId();
    return new BodySwap.Attempt(
        inCreative(player), book.inside(id), busy(id), inArena(id), otherSealed(player));
  }

  private boolean busy(UUID player) {
    return opening.contains(player) || closing.contains(player);
  }

  private boolean inCreative(Player player) {
    return world.getName().equals(player.getWorld().getName());
  }

  private boolean inArena(UUID player) {
    return context
        .services()
        .find(ArenaPresence.class)
        .flatMap(presence -> presence.arenaOf(player))
        .isPresent();
  }

  private boolean otherSealed(Player player) {
    return !inCreative(player) && sealed.isSealed(player.getWorld());
  }

  private void cross(UUID player, Runnable teleport) {
    crossing.add(player);
    try {
      teleport.run();
    } finally {
      crossing.remove(player);
    }
  }

  private <T> void listen(
      CompletableFuture<T> future, String what, java.util.function.Consumer<T> then) {
    var _ =
        future.whenCompleteAsync(
            (value, failure) -> {
              if (failure != null) {
                context.logger().error("Could not {}", what, failure);
                return;
              }
              if (value == null) {
                context.logger().error("Could not {}", what);
                return;
              }
              guarded(what, () -> then.accept(value));
            },
            context.scheduler().mainThread());
  }

  private void logFailure(CompletableFuture<?> future, String what) {
    var _ =
        future.whenComplete(
            (value, failure) -> {
              if (failure != null) {
                context.logger().error("Could not {}", what, failure);
              }
            });
  }

  private void guarded(String what, Runnable work) {
    try {
      work.run();
    } catch (RuntimeException failure) {
      context.logger().error("Unexpected failure while {}", what, failure);
    }
  }

  private static Optional<VisitBody> role(List<VisitBody> bodies, BodyRole role) {
    return bodies.stream().filter(body -> body.role() == role).findFirst();
  }

  private static String refusal(BodySwap.Verdict verdict) {
    return switch (verdict) {
      case ALREADY ->
          "You are already in creative. /creative leave returns your survival belongings.";
      case RESTORE_FIRST ->
          "Your survival belongings are still being restored. Try again in a moment.";
      case BUSY -> "Your creative visit is still being saved.";
      case IN_ARENA -> "Leave the arena before entering creative.";
      case SEALED -> "Leave that world before entering creative.";
      case OPEN_AT_SPAWN, OPEN_HERE -> throw new IllegalStateException("not a refusal: " + verdict);
    };
  }

  private static void error(Player player, String text) {
    player.sendMessage(HouseStyle.error(LABEL, Component.text(text)));
  }

  private static void success(Player player, String text) {
    player.sendMessage(HouseStyle.success(LABEL, Component.text(text)));
  }
}
