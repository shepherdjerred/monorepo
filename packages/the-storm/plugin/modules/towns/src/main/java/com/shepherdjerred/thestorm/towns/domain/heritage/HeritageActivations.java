package com.shepherdjerred.thestorm.towns.domain.heritage;

import com.shepherdjerred.thestorm.towns.domain.town.Town;
import com.shepherdjerred.thestorm.towns.domain.town.TownDirectory;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.function.Predicate;

/**
 * Gives each player heritage site's proven mayor the town the site names, once. A restored archive
 * ships its towns in the catalog; this turns them into active towns without an offline import.
 */
public final class HeritageActivations {

  private HeritageActivations() {}

  /** What startup does for one player heritage site that has no activation record yet. */
  public sealed interface Step {
    String siteId();

    /** Found {@code town} for the site's mayor and record it. */
    record Found(String siteId, Town town) implements Step {}

    /** The site's town already exists (an earlier import); record it without founding. */
    record Existing(String siteId, UUID townId) implements Step {}

    /** Leave the site for a later start; nothing is recorded. */
    record Wait(String siteId, String reason) implements Step {}
  }

  /**
   * What is already stored.
   *
   * @param activated site ids already recorded
   * @param townExists whether a town with that id is stored, under any name
   */
  public record Stored(Set<String> activated, Predicate<UUID> townExists) {
    public Stored {
      activated = Set.copyOf(activated);
    }
  }

  /**
   * One step per player site not yet recorded, in catalog order.
   *
   * @param sites every heritage site; only {@link HeritageSite.Kind#PLAYER} sites name towns
   * @param stored the recorded activations and stored towns
   * @param towns the current towns
   * @param now the founding time
   */
  public static List<Step> plan(
      List<HeritageSite> sites, Stored stored, TownDirectory towns, Instant now) {
    var steps = new ArrayList<Step>();
    for (var site : sites) {
      if (site.kind() != HeritageSite.Kind.PLAYER || stored.activated().contains(site.id())) {
        continue;
      }
      var id = site.activeTownId().orElseThrow();
      var mayor = site.editors().getFirst();
      var membership = towns.townOf(mayor.player());
      if (stored.townExists().test(id)) {
        steps.add(new Step.Existing(site.id(), id));
      } else if (membership.isPresent()) {
        steps.add(
            new Step.Wait(
                site.id(),
                mayor.name() + " already belongs to " + membership.orElseThrow().name()));
      } else if (towns.named(site.activeTownName()).isPresent()) {
        steps.add(new Step.Wait(site.id(), "the name " + site.activeTownName() + " is taken"));
      } else {
        steps.add(
            new Step.Found(site.id(), Town.found(id, site.activeTownName(), now, mayor.player())));
      }
    }
    return List.copyOf(steps);
  }
}
