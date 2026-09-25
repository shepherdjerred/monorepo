package com.shepherdjerred.thestorm.essentials.adapter.paper;

import com.shepherdjerred.thestorm.core.protection.Decision;
import com.shepherdjerred.thestorm.core.protection.ProtectedAction;
import com.shepherdjerred.thestorm.core.protection.Protection;
import com.shepherdjerred.thestorm.core.result.Result;
import com.shepherdjerred.thestorm.core.schedule.Cancellable;
import com.shepherdjerred.thestorm.core.text.HouseStyle;
import com.shepherdjerred.thestorm.essentials.app.GuardRegistry;
import com.shepherdjerred.thestorm.essentials.app.TeleportPayments;
import com.shepherdjerred.thestorm.essentials.app.TeleportRefusal;
import com.shepherdjerred.thestorm.essentials.domain.back.BackEntry;
import com.shepherdjerred.thestorm.essentials.domain.place.DurationText;
import com.shepherdjerred.thestorm.essentials.domain.place.Position;
import com.shepherdjerred.thestorm.essentials.domain.teleport.Exemptions;
import com.shepherdjerred.thestorm.essentials.domain.teleport.Quote;
import com.shepherdjerred.thestorm.essentials.domain.teleport.TeleportKind;
import com.shepherdjerred.thestorm.essentials.domain.teleport.Warmup;
import java.time.Duration;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.function.Consumer;
import net.kyori.adventure.text.Component;
import org.bukkit.Location;
import org.bukkit.entity.Player;

/**
 * Runs a paid teleport on the main thread: guards, quote, warmup, guards again, a safe landing
 * spot, charge, teleport, then the usage and {@code /back} records.
 *
 * <p>Each player is locked from the quote until the teleport finishes or fails, whichever way it
 * fails; leaving the server releases the lock. Crystals are taken only after the landing spot is
 * known to be safe, and returned if the teleport still does not happen. The usage (price multiplier
 * and cooldown) is recorded only once the player has arrived.
 */
final class TeleportFlow {

  private static final String FAILED = "Something went wrong with that teleport. Try again.";

  private final PaperRuntime runtime;
  private final Services services;
  private final Duration warmup;
  private final Map<UUID, Pending> warmingUp = new HashMap<>();
  private final Map<UUID, Ticket> busy = new HashMap<>();

  TeleportFlow(PaperRuntime runtime, Services services, Duration warmup) {
    this.runtime = runtime;
    this.services = services;
    this.warmup = warmup;
  }

  /**
   * What the flow needs from the rest of the module.
   *
   * @param payments pricing and charging
   * @param guards the teleport guards other modules add
   * @param protection land protection, asked for {@code TELEPORT_INTO} on player-chosen places
   * @param back {@code /back} recording
   */
  record Services(
      TeleportPayments payments, GuardRegistry guards, Protection protection, BackRecorder back) {}

  private record Pending(Ticket ticket, Exemptions exemptions, Position start, Cancellable task) {}

  /** Starts {@code ticket}: checks guards and cooldown, then begins the warmup. */
  void start(Ticket ticket) {
    var mover = ticket.mover();
    var payer = ticket.payer();
    if (isBusy(mover.getUniqueId()) || isBusy(payer.getUniqueId())) {
      Say.error(payer, Say.TELEPORT, "A teleport is already under way.");
      return;
    }
    var destination = ticket.destination().resolve();
    if (destination.isEmpty()) {
      Say.error(payer, Say.TELEPORT, "Teleport cancelled: the destination is no longer there.");
      return;
    }
    if (refused(ticket, destination.orElseThrow())) {
      return;
    }
    lock(ticket);
    var exemptions = exemptions(payer);
    next(
        services.payments().quote(payer.getUniqueId(), ticket.kind(), exemptions),
        ticket,
        "quoting a teleport",
        quoted -> afterQuote(ticket, exemptions, quoted));
  }

  /** Whether {@code player} is moving or paying in a teleport that has not finished. */
  boolean isBusy(UUID player) {
    return busy.containsKey(player);
  }

  /** Cancels a warmup because {@code player} moved (or was carried) off its starting block. */
  void moved(Player player, Location to) {
    var pending = warmingUp.get(player.getUniqueId());
    if (pending != null && Warmup.interruptedBy(pending.start(), Positions.of(to))) {
      cancel(player.getUniqueId(), "you moved");
    }
  }

  /** Cancels a warmup because {@code player} took damage. */
  void damaged(Player player) {
    if (warmingUp.containsKey(player.getUniqueId())) {
      cancel(player.getUniqueId(), "you took damage");
    }
  }

  /** {@code player} left: cancels warmups they move in or pay for, and releases their lock. */
  void left(UUID player) {
    List.copyOf(warmingUp.values()).stream()
        .filter(p -> involves(p.ticket(), player))
        .forEach(p -> cancel(p.ticket().mover().getUniqueId(), "a player left"));
    busy.remove(player);
  }

  /** Cancels every warmup, on disable. */
  void cancelAll() {
    warmingUp.values().forEach(pending -> pending.task().cancel());
    warmingUp.clear();
    busy.clear();
  }

  private void afterQuote(
      Ticket ticket, Exemptions exemptions, Result<Quote, TeleportRefusal> quoted) {
    if (!bothOnline(ticket)) {
      release(ticket);
      return;
    }
    switch (quoted) {
      case Result.Err<Quote, TeleportRefusal>(var refusal) -> {
        release(ticket);
        tellRefusal(ticket, refusal);
      }
      case Result.Ok<Quote, TeleportRefusal>(var quote) -> beginWarmup(ticket, exemptions, quote);
    }
  }

  private void beginWarmup(Ticket ticket, Exemptions exemptions, Quote quote) {
    var price =
        quote.cost() == 0 ? "free" : quote.cost() + " crystals (" + quote.multiplier() + ")";
    Say.info(ticket.payer(), Say.TELEPORT, "This teleport costs " + price + ".");
    if (warmup.isZero()) {
      land(ticket, exemptions);
      return;
    }
    var mover = ticket.mover();
    Say.info(
        mover,
        Say.TELEPORT,
        "Teleporting to "
            + ticket.destination().describe()
            + " in "
            + DurationText.format(warmup)
            + ". Don't move.");
    var id = mover.getUniqueId();
    var task =
        runtime
            .scheduler()
            .runOnMainThreadLater(
                warmup,
                () -> {
                  var pending = warmingUp.remove(id);
                  if (pending != null) {
                    guarded(pending.ticket(), () -> land(pending.ticket(), pending.exemptions()));
                  }
                });
    warmingUp.put(id, new Pending(ticket, exemptions, Positions.of(mover), task));
  }

  /** The warmup is over: re-checks guards, finds a safe spot, then charges. */
  private void land(Ticket ticket, Exemptions exemptions) {
    if (!bothOnline(ticket)) {
      release(ticket);
      return;
    }
    var destination = ticket.destination().resolve();
    if (destination.isEmpty()) {
      release(ticket);
      Say.error(ticket.payer(), Say.TELEPORT, "Teleport cancelled: the destination is gone.");
      return;
    }
    var target = destination.orElseThrow();
    if (refused(ticket, target)) {
      release(ticket);
      return;
    }
    if (SafeLocations.isLoaded(target)) {
      chargeFor(ticket, exemptions, target);
      return;
    }
    next(
        target.getWorld().getChunkAtAsync(target),
        ticket,
        "loading the destination",
        chunk -> chargeFor(ticket, exemptions, target));
  }

  private void chargeFor(Ticket ticket, Exemptions exemptions, Location target) {
    var safe = SafeLocations.nearestSafe(target);
    if (safe.isEmpty()) {
      release(ticket);
      Say.error(
          ticket.payer(),
          Say.TELEPORT,
          "Teleport cancelled: there is nowhere safe to stand at "
              + ticket.destination().describe()
              + ".");
      return;
    }
    next(
        services.payments().charge(ticket.payer().getUniqueId(), ticket.kind(), exemptions),
        ticket,
        "charging a teleport",
        charged -> afterCharge(ticket, charged, safe.orElseThrow()));
  }

  private void afterCharge(Ticket ticket, Result<Quote, TeleportRefusal> charged, Location safe) {
    switch (charged) {
      case Result.Err<Quote, TeleportRefusal>(var refusal) -> {
        release(ticket);
        if (bothOnline(ticket)) {
          tellRefusal(ticket, refusal);
        }
      }
      case Result.Ok<Quote, TeleportRefusal>(var quote) -> teleport(ticket, quote, safe);
    }
  }

  private void teleport(Ticket ticket, Quote quote, Location safe) {
    if (!bothOnline(ticket)) {
      refundAndRelease(ticket, quote, "a player left");
      return;
    }
    var mover = ticket.mover();
    var left = Positions.of(mover);
    CompletableFuture<Boolean> arrival;
    try {
      arrival = mover.teleportAsync(safe);
    } catch (RuntimeException e) {
      runtime.report("teleporting a player", e);
      refundAndRelease(ticket, quote, "the teleport failed");
      return;
    }
    runtime.onMain(
        arrival,
        "teleporting a player",
        moved -> {
          if (!Boolean.TRUE.equals(moved)) {
            refundAndRelease(ticket, quote, "the teleport was blocked");
            return;
          }
          release(ticket);
          runtime.logFailure(
              services.payments().confirm(ticket.payer().getUniqueId(), quote),
              "recording teleport usage");
          services.back().record(mover.getUniqueId(), left, BackEntry.Cause.TELEPORT);
          Say.success(
              mover, Say.TELEPORT, "Teleported to " + ticket.destination().describe() + ".");
        },
        failure -> refundAndRelease(ticket, quote, "the teleport failed"));
  }

  /** Returns the crystals, then releases the lock and tells the payer once the refund is done. */
  private void refundAndRelease(Ticket ticket, Quote quote, String why) {
    var payer = ticket.payer();
    runtime.onMain(
        services.payments().refund(payer.getUniqueId(), quote),
        "refunding a teleport",
        refunded -> {
          release(ticket);
          var suffix =
              quote.cost() == 0 ? "." : "; your " + quote.cost() + " crystals were refunded.";
          Say.error(payer, Say.TELEPORT, "Teleport cancelled: " + why + suffix);
        },
        failure -> {
          release(ticket);
          Say.error(
              payer,
              Say.TELEPORT,
              "Teleport cancelled: " + why + ", and the refund failed. Tell staff.");
        });
  }

  /**
   * Continues with {@code then} on the main thread; any failure (including one thrown by {@code
   * then}) releases the lock and tells the payer.
   */
  private <T> void next(CompletableFuture<T> future, Ticket ticket, String what, Consumer<T> then) {
    runtime.onMain(future, what, then, failure -> failed(ticket));
  }

  /** Runs {@code step}; if it throws, releases the lock and tells the payer. */
  private void guarded(Ticket ticket, Runnable step) {
    try {
      step.run();
    } catch (RuntimeException e) {
      runtime.report("teleporting", e);
      failed(ticket);
    }
  }

  private void failed(Ticket ticket) {
    release(ticket);
    if (ticket.payer().isOnline()) {
      Say.error(ticket.payer(), Say.TELEPORT, FAILED);
    }
  }

  private void cancel(UUID mover, String why) {
    var pending = warmingUp.remove(mover);
    if (pending == null) {
      return;
    }
    pending.task().cancel();
    release(pending.ticket());
    Say.error(pending.ticket().mover(), Say.TELEPORT, "Teleport cancelled: " + why + ".");
    if (pending.ticket().paidByOther()) {
      Say.error(pending.ticket().payer(), Say.TELEPORT, "Teleport cancelled: " + why + ".");
    }
  }

  private boolean refused(Ticket ticket, Location destination) {
    var refusal = refusal(ticket, destination);
    if (refusal.isEmpty()) {
      return false;
    }
    var message = Component.text("You can't teleport there: ").append(refusal.orElseThrow());
    ticket.payer().sendMessage(HouseStyle.error(Say.TELEPORT, message));
    if (ticket.paidByOther()) {
      ticket.mover().sendMessage(HouseStyle.error(Say.TELEPORT, message));
    }
    return true;
  }

  private Optional<Component> refusal(Ticket ticket, Location destination) {
    var mover = ticket.mover().getUniqueId();
    var guard = services.guards().check(mover, destination);
    if (guard.isPresent() || !playerChosen(ticket.kind())) {
      return guard;
    }
    return switch (services.protection().check(mover, ProtectedAction.TELEPORT_INTO, destination)) {
      case Decision.Allowed() -> Optional.empty();
      case Decision.Denied(var reason) -> Optional.of(reason);
    };
  }

  /**
   * Places players pick themselves are checked against claims; staff-set spawn and warps are not.
   */
  private static boolean playerChosen(TeleportKind kind) {
    return switch (kind) {
      case HOME, TPA, BACK -> true;
      case SPAWN, WARP -> false;
    };
  }

  private static void tellRefusal(Ticket ticket, TeleportRefusal refusal) {
    var message =
        switch (refusal) {
          case TeleportRefusal.Cooldown(var cooldown) ->
              "You can use /"
                  + cooldown.kind().id()
                  + " again in "
                  + DurationText.format(cooldown.remaining())
                  + ".";
          case TeleportRefusal.CannotAfford(var balance, var required) ->
              "This teleport costs " + required + " crystals; you have " + balance + ".";
        };
    Say.error(ticket.payer(), Say.TELEPORT, message);
  }

  private void lock(Ticket ticket) {
    busy.put(ticket.mover().getUniqueId(), ticket);
    busy.put(ticket.payer().getUniqueId(), ticket);
  }

  private void release(Ticket ticket) {
    busy.remove(ticket.mover().getUniqueId(), ticket);
    busy.remove(ticket.payer().getUniqueId(), ticket);
  }

  private static boolean involves(Ticket ticket, UUID player) {
    return ticket.mover().getUniqueId().equals(player)
        || ticket.payer().getUniqueId().equals(player);
  }

  private static boolean bothOnline(Ticket ticket) {
    return ticket.mover().isOnline() && ticket.payer().isOnline();
  }

  private static Exemptions exemptions(Player payer) {
    return new Exemptions(
        payer.hasPermission(EssentialsPermissions.TELEPORT_FREE),
        payer.hasPermission(EssentialsPermissions.TELEPORT_NO_COOLDOWN));
  }
}
