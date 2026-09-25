package com.shepherdjerred.thestorm.essentials.adapter.paper;

import com.shepherdjerred.thestorm.core.result.Result;
import com.shepherdjerred.thestorm.core.schedule.Cancellable;
import com.shepherdjerred.thestorm.essentials.app.GuardRegistry;
import com.shepherdjerred.thestorm.essentials.app.TeleportPayments;
import com.shepherdjerred.thestorm.essentials.app.TeleportRefusal;
import com.shepherdjerred.thestorm.essentials.domain.back.BackEntry;
import com.shepherdjerred.thestorm.essentials.domain.place.DurationText;
import com.shepherdjerred.thestorm.essentials.domain.place.Position;
import com.shepherdjerred.thestorm.essentials.domain.teleport.Exemptions;
import com.shepherdjerred.thestorm.essentials.domain.teleport.Quote;
import com.shepherdjerred.thestorm.essentials.domain.teleport.Warmup;
import java.time.Duration;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import org.bukkit.Location;
import org.bukkit.entity.Player;

/**
 * Runs a paid teleport on the main thread: guards, quote, warmup, guards again, payment, teleport,
 * {@code /back} record. One teleport per player at a time; moving to another block, taking damage
 * or leaving cancels the warmup. If the teleport cannot happen after payment, the crystals are
 * refunded.
 */
final class TeleportFlow {

  private final PaperRuntime runtime;
  private final TeleportPayments payments;
  private final GuardRegistry guards;
  private final BackRecorder back;
  private final Duration warmup;
  private final Map<UUID, Pending> warmingUp = new HashMap<>();
  private final Set<UUID> busy = new HashSet<>();

  TeleportFlow(PaperRuntime runtime, Services services, Duration warmup) {
    this.runtime = runtime;
    this.payments = services.payments();
    this.guards = services.guards();
    this.back = services.back();
    this.warmup = warmup;
  }

  /**
   * What the flow needs from the app layer.
   *
   * @param payments pricing and charging
   * @param guards the teleport guards other modules add
   * @param back {@code /back} recording
   */
  record Services(TeleportPayments payments, GuardRegistry guards, BackRecorder back) {}

  private record Pending(Ticket ticket, Position start, Cancellable task) {}

  /** Starts {@code ticket}: checks guards and cooldown, then begins the warmup. */
  void start(Ticket ticket) {
    var mover = ticket.mover();
    var payer = ticket.payer();
    if (busy.contains(mover.getUniqueId()) || busy.contains(payer.getUniqueId())) {
      Say.error(payer, Say.TELEPORT, "A teleport is already under way.");
      return;
    }
    if (refusedByGuard(ticket)) {
      return;
    }
    busy.add(mover.getUniqueId());
    busy.add(payer.getUniqueId());
    var exemptions = exemptions(payer);
    runtime.onMain(
        payments.quote(payer.getUniqueId(), ticket.kind(), exemptions),
        "quoting a teleport",
        quoted -> afterQuote(ticket, exemptions, quoted));
  }

  /** Cancels a warmup because {@code player} moved from its starting block. */
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

  /** Cancels any warmup {@code player} moves in or pays for, because they left. */
  void left(UUID player) {
    List.copyOf(warmingUp.values()).stream()
        .filter(
            p ->
                p.ticket().mover().getUniqueId().equals(player)
                    || p.ticket().payer().getUniqueId().equals(player))
        .forEach(p -> cancel(p.ticket().mover().getUniqueId(), "a player left"));
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
    var mover = ticket.mover();
    var price =
        quote.cost() == 0 ? "free" : quote.cost() + " crystals (" + quote.multiplier() + ")";
    Say.info(ticket.payer(), Say.TELEPORT, "This teleport costs " + price + ".");
    if (warmup.isZero()) {
      pay(ticket, exemptions);
      return;
    }
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
                  if (warmingUp.remove(id) != null) {
                    pay(ticket, exemptions);
                  }
                });
    warmingUp.put(id, new Pending(ticket, Positions.of(mover), task));
  }

  private void pay(Ticket ticket, Exemptions exemptions) {
    if (!bothOnline(ticket)) {
      release(ticket);
      return;
    }
    if (refusedByGuard(ticket)) {
      release(ticket);
      return;
    }
    runtime.onMain(
        payments.pay(ticket.payer().getUniqueId(), ticket.kind(), exemptions),
        "charging a teleport",
        paid -> afterPayment(ticket, paid));
  }

  private void afterPayment(Ticket ticket, Result<Quote, TeleportRefusal> paid) {
    switch (paid) {
      case Result.Err<Quote, TeleportRefusal>(var refusal) -> {
        release(ticket);
        if (bothOnline(ticket)) {
          tellRefusal(ticket, refusal);
        }
      }
      case Result.Ok<Quote, TeleportRefusal>(var quote) -> teleport(ticket, quote);
    }
  }

  private void teleport(Ticket ticket, Quote quote) {
    var mover = ticket.mover();
    var destination =
        bothOnline(ticket) ? ticket.destination().resolve() : Optional.<Location>empty();
    if (destination.isEmpty()) {
      release(ticket);
      refund(ticket, quote, "the destination is no longer there");
      return;
    }
    var left = Positions.of(mover);
    var _ =
        mover
            .teleportAsync(destination.orElseThrow())
            .whenCompleteAsync(
                (moved, failure) -> {
                  release(ticket);
                  if (failure == null && Boolean.TRUE.equals(moved)) {
                    back.record(mover.getUniqueId(), left, BackEntry.Cause.TELEPORT);
                    Say.success(
                        mover,
                        Say.TELEPORT,
                        "Teleported to " + ticket.destination().describe() + ".");
                  } else {
                    refund(ticket, quote, "the teleport failed");
                  }
                },
                runtime.main());
  }

  private void refund(Ticket ticket, Quote quote, String why) {
    runtime.logFailure(
        payments.refund(ticket.payer().getUniqueId(), quote), "refunding a teleport");
    var suffix = quote.cost() == 0 ? "." : "; your " + quote.cost() + " crystals were refunded.";
    Say.error(ticket.payer(), Say.TELEPORT, "Teleport cancelled: " + why + suffix);
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

  private boolean refusedByGuard(Ticket ticket) {
    var refusal = guards.check(ticket.mover().getUniqueId());
    if (refusal.isEmpty()) {
      return false;
    }
    Say.error(ticket.payer(), Say.TELEPORT, "You can't teleport now: " + refusal.orElseThrow());
    if (ticket.paidByOther()) {
      Say.error(ticket.mover(), Say.TELEPORT, "You can't teleport now: " + refusal.orElseThrow());
    }
    return true;
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

  private void release(Ticket ticket) {
    busy.remove(ticket.mover().getUniqueId());
    busy.remove(ticket.payer().getUniqueId());
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
