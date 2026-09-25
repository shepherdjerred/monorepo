package com.shepherdjerred.thestorm.npcs.app;

import com.shepherdjerred.thestorm.core.result.Result;
import com.shepherdjerred.thestorm.npcs.domain.dialogue.Screen;
import com.shepherdjerred.thestorm.npcs.domain.npc.NpcDefinition;
import com.shepherdjerred.thestorm.npcs.domain.trainer.Offer;
import com.shepherdjerred.thestorm.npcs.domain.trainer.TrainerScreens;
import com.shepherdjerred.thestorm.tracks.app.Purchase;
import com.shepherdjerred.thestorm.tracks.app.PurchaseProblem;
import com.shepherdjerred.thestorm.tracks.app.Quote;
import com.shepherdjerred.thestorm.tracks.app.Track;
import com.shepherdjerred.thestorm.tracks.app.TrackLevels;
import com.shepherdjerred.thestorm.tracks.app.TrackPurchases;
import java.util.List;
import java.util.Locale;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.Executor;
import org.bukkit.entity.Player;

/**
 * Trainer NPCs: quote the next level of the NPC's track through {@link TrackPurchases}, ask the
 * player to confirm, then buy it. Prices and rules belong to the tracks module; this only presents
 * them.
 */
public final class Trainer {

  private final TrackPurchases purchases;
  private final TrackLevels levels;
  private final TrainerWording wording;
  private final Executor mainThread;

  public Trainer(
      TrackPurchases purchases, TrackLevels levels, TrainerWording wording, Executor mainThread) {
    this.purchases = purchases;
    this.levels = levels;
    this.wording = wording;
    this.mainThread = mainThread;
  }

  /** The track {@code npc} trains; content validation guarantees it has one. */
  static Track track(NpcDefinition npc) {
    var id =
        npc.trainer()
            .orElseThrow(() -> new IllegalStateException("NPC " + npc.id() + " trains no track"));
    return Track.valueOf(id.toUpperCase(Locale.ROOT));
  }

  /** The offer screen for {@code player}, led by {@code note}. Completes on the main thread. */
  public CompletableFuture<Screen> offer(Player player, NpcDefinition npc, String note) {
    var track = track(npc);
    return purchases
        .quote(player.getUniqueId(), track)
        .thenApplyAsync(
            quoted -> {
              var standing =
                  new TrainerScreens.Standing(
                      TrainerWording.trackName(track),
                      levels.level(player, track),
                      Track.MAX_LEVEL);
              return TrainerScreens.offer(npc.name(), standing, present(quoted), note);
            },
            mainThread);
  }

  /** The confirmation screen for {@code offer}. */
  public Screen confirm(NpcDefinition npc, Offer offer) {
    return TrainerScreens.confirm(
        npc.name(), TrainerWording.trackName(track(npc)), offer, wording.crystals(offer.cost()));
  }

  /**
   * Buys {@code offer} for {@code player}; completes on the main thread with a line saying how it
   * went.
   */
  public CompletableFuture<String> buy(Player player, NpcDefinition npc, Offer offer) {
    var track = track(npc);
    return purchases
        .buy(player.getUniqueId(), new Quote(track, offer.level(), offer.cost()))
        .thenApplyAsync(this::outcome, mainThread);
  }

  private TrainerScreens.Quote present(Result<Quote, List<PurchaseProblem>> quoted) {
    return switch (quoted) {
      case Result.Ok<Quote, List<PurchaseProblem>>(var quote) ->
          new TrainerScreens.Quote.Quoted(
              new Offer(quote.track().id(), quote.level(), quote.cost()),
              wording.crystals(quote.cost()));
      case Result.Err<Quote, List<PurchaseProblem>>(var problems) ->
          new TrainerScreens.Quote.Refused(problems.stream().map(wording::explain).toList());
    };
  }

  private String outcome(Result<Purchase, List<PurchaseProblem>> bought) {
    return switch (bought) {
      case Result.Ok<Purchase, List<PurchaseProblem>>(var purchase) -> {
        var name = TrainerWording.trackName(purchase.quote().track());
        var line = "You are now level " + purchase.quote().level() + " in " + name + ".";
        yield purchase.primary() ? line + " " + name + " is your primary track." : line;
      }
      case Result.Err<Purchase, List<PurchaseProblem>>(var problems) ->
          String.join(" ", problems.stream().map(wording::explain).toList());
    };
  }
}
