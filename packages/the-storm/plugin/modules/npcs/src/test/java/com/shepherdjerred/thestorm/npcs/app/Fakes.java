package com.shepherdjerred.thestorm.npcs.app;

import com.shepherdjerred.thestorm.core.result.Result;
import com.shepherdjerred.thestorm.npcs.domain.dialogue.Screen;
import com.shepherdjerred.thestorm.tracks.app.Purchase;
import com.shepherdjerred.thestorm.tracks.app.PurchaseProblem;
import com.shepherdjerred.thestorm.tracks.app.Quote;
import com.shepherdjerred.thestorm.tracks.app.Track;
import com.shepherdjerred.thestorm.tracks.app.TrackLevels;
import com.shepherdjerred.thestorm.tracks.app.TrackPurchases;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.function.IntConsumer;
import org.bukkit.entity.Player;

/** Test doubles for the app layer. */
final class Fakes {

  private Fakes() {}

  /** Records shown screens and lets tests press their buttons. */
  static final class Presenter implements DialogPresenter {

    record Shown(Player player, Screen screen, IntConsumer onClick) {

      void press(String label) {
        var buttons = screen.buttons();
        for (var i = 0; i < buttons.size(); i++) {
          if (buttons.get(i).label().equals(label)) {
            onClick.accept(i);
            return;
          }
        }
        throw new AssertionError("no button " + label + " on " + screen);
      }
    }

    final List<Shown> shown = new ArrayList<>();
    final List<Player> closed = new ArrayList<>();

    @Override
    public void show(Player player, Screen screen, IntConsumer onClick) {
      shown.add(new Shown(player, screen, onClick));
    }

    @Override
    public void close(Player player) {
      closed.add(player);
    }

    Shown last() {
      if (shown.isEmpty()) {
        throw new AssertionError("nothing was shown");
      }
      return shown.getLast();
    }
  }

  /** Answers quotes and purchases with whatever the test sets. */
  static final class Purchases implements TrackPurchases {

    CompletableFuture<Result<Quote, List<PurchaseProblem>>> nextQuote =
        CompletableFuture.completedFuture(Result.ok(new Quote(Track.SHOPKEEPER, 1, 1000)));
    Result<Purchase, List<PurchaseProblem>> nextBuy =
        Result.ok(new Purchase(new Quote(Track.SHOPKEEPER, 1, 1000), true, 7));
    final List<Quote> bought = new ArrayList<>();
    final List<Track> quoted = new ArrayList<>();

    @Override
    public CompletableFuture<Result<Quote, List<PurchaseProblem>>> quote(UUID player, Track track) {
      quoted.add(track);
      return nextQuote;
    }

    @Override
    public CompletableFuture<Result<Purchase, List<PurchaseProblem>>> buy(
        UUID player, Quote quote) {
      bought.add(quote);
      return CompletableFuture.completedFuture(nextBuy);
    }
  }

  /** Levels set by the test. */
  static final class Levels implements TrackLevels {

    final Map<Track, Integer> levels = new HashMap<>();

    @Override
    public int level(Player player, Track track) {
      return levels.getOrDefault(track, 0);
    }
  }

  /** Records marker updates. */
  static final class Displays implements MarkerService.MarkerDisplays {

    record Update(Player player, String npc, QuestMarker marker) {}

    final List<Update> updates = new ArrayList<>();

    @Override
    public void update(Player player, String npc, QuestMarker marker) {
      updates.add(new Update(player, npc, marker));
    }
  }
}
