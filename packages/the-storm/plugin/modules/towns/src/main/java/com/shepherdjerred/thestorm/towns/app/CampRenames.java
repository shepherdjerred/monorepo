package com.shepherdjerred.thestorm.towns.app;

import com.shepherdjerred.thestorm.core.players.PlayerDirectory;
import com.shepherdjerred.thestorm.towns.domain.town.Town;
import com.shepherdjerred.thestorm.towns.domain.town.TownNames;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Optional;
import java.util.concurrent.CompletableFuture;
import java.util.function.Consumer;

/**
 * Gives camps that still have a generated {@code camp_} plus hex name their founder's account name.
 * A missing directory row is logged and left alone. Runs once per such camp.
 */
public final class CampRenames {

  private CampRenames() {}

  /** The renamed camp, when {@code accountName} can become a free town name. */
  public static Optional<Town> rename(
      Town camp, String accountName, java.util.function.Predicate<String> taken) {
    if (!camp.isCamp() || !TownNames.isGenerated(camp.name())) {
      return Optional.empty();
    }
    return TownNames.friendly(accountName, taken).map(camp::renamed);
  }

  /**
   * Renames every generated camp still in {@code state}, saving each one before replacing it in
   * memory. Completes off the directory's thread. {@code log} receives one line per camp left
   * unchanged.
   */
  public static CompletableFuture<Integer> apply(
      TownsState state, TownsStore store, PlayerDirectory directory, Consumer<String> log) {
    var reserved = new HashSet<String>();
    for (var town : state.towns()) {
      reserved.add(town.name().toLowerCase(Locale.ROOT));
    }
    var generated = new ArrayList<Town>();
    for (var town : state.towns()) {
      if (town.isCamp() && TownNames.isGenerated(town.name())) {
        generated.add(town);
      }
    }
    var renamed = new int[] {0};
    CompletableFuture<Void> chain = CompletableFuture.completedFuture(null);
    for (var camp : List.copyOf(generated)) {
      chain =
          chain.thenCompose(ignored ->
              directory
                  .byId(camp.owner())
                  .thenCompose(found -> {
                    if (found.isEmpty()) {
                      log.accept(
                          "left camp "
                              + camp.name()
                              + " unnamed; owner "
                              + camp.owner()
                              + " is not in the player directory");
                      return CompletableFuture.completedFuture(null);
                    }
                    reserved.remove(camp.name().toLowerCase(Locale.ROOT));
                    var next =
                        rename(
                            camp,
                            found.orElseThrow().lastName(),
                            candidate -> reserved.contains(candidate.toLowerCase(Locale.ROOT)));
                    if (next.isEmpty()) {
                      reserved.add(camp.name().toLowerCase(Locale.ROOT));
                      log.accept(
                          "left camp "
                              + camp.name()
                              + " unnamed; "
                              + found.orElseThrow().lastName()
                              + " is not a usable camp name");
                      return CompletableFuture.completedFuture(null);
                    }
                    var town = next.orElseThrow();
                    reserved.add(town.name().toLowerCase(Locale.ROOT));
                    return store
                        .saveTown(town)
                        .thenRun(() -> {
                          state.replaceTown(town);
                          renamed[0]++;
                        });
                  }));
    }
    return chain.thenApply(ignored -> renamed[0]);
  }
}
