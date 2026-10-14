package com.shepherdjerred.thestorm.rwf.adapter.paper;

import com.shepherdjerred.thestorm.rwf.app.BotDifficulty;
import com.shepherdjerred.thestorm.rwf.app.BotDraftRequest;
import com.shepherdjerred.thestorm.rwf.domain.map.MapDefinition;
import com.shepherdjerred.thestorm.rwf.domain.match.Ballot;
import com.shepherdjerred.thestorm.rwf.domain.match.Phase;
import java.time.Duration;
import java.util.Optional;
import java.util.OptionalInt;

/** Drafts a round's population under its frozen settings and explains the pending arrivals. */
final class BotPopulation {
  private final MatchRunner runner;
  private final Bots bots;
  private final BotArrivals arrivals;
  private final int maximum;
  private int drafted;

  BotPopulation(MatchRunner runner, Bots bots, BotArrivals arrivals, int maximum) {
    this.runner = runner;
    this.bots = bots;
    this.arrivals = arrivals;
    this.maximum = maximum;
  }

  void draft(MapDefinition map, OptionalInt showcase) {
    var match = runner.match();
    runner.experiences().freeze(match.matchId(), match.seed());
    var target = runner.lobbySizes().draft(map, showcase);
    runner.session().lock();
    var options = runner.session().current();
    var configured = runner.features().hostSettings() && showcase.isEmpty();
    var present = configured ? runner.humans() : match.members().size();
    var existingBots = match.members().size() - runner.humans();
    var desired = options.botsFor(target, present, maximum);
    var count = configured ? Math.max(0, desired - existingBots) : desired;
    var difficulty =
        configured ? Optional.of(options.difficulty()) : Optional.<BotDifficulty>empty();
    var added = bots.fill(new BotDraftRequest(match.matchId(), count, difficulty));
    drafted = existingBots + added.size();
    var now = runner.now();
    arrivals.schedule(added, match.seed(), now, RunnerRules.arrivalBudget(match, now));
  }

  void reset() {
    drafted = 0;
  }

  String status() {
    var settings = runner.session().current();
    if (settings.count().isPresent() && settings.count().getAsInt() == 0) return "Bots off";
    if (bots.roster().isEmpty()) return "Bots unavailable";
    if (arrivals.size() > 0) {
      var seconds =
          arrivals.nextIn(runner.now()).map(delay -> (delay.toMillis() + 999) / 1000).orElseThrow();
      return "Bots joining: " + arrivals.size() + " (next in " + seconds + "s)";
    }
    if (drafted > 0) return "Bots ready: " + drafted;
    var match = runner.match();
    if (match.map().isEmpty()) {
      if (match.ballot().filter(Ballot::closed).isPresent()) return "Bots wait for map loading";
      if (match.phase() instanceof Phase.Countdown countdown) {
        var delay =
            Duration.between(runner.now(), countdown.startsAt().minus(match.settings().voteLead()));
        var seconds = Math.max(0, (delay.toMillis() + 999) / 1000);
        return "Bots join after voting closes in " + seconds + "s";
      }
      return "Bots join after the map vote";
    }
    return "No bots available for this round";
  }
}
