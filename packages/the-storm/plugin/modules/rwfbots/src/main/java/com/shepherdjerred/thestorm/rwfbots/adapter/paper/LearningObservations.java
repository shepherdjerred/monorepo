package com.shepherdjerred.thestorm.rwfbots.adapter.paper;

import com.shepherdjerred.thestorm.rwf.app.MatchView;
import com.shepherdjerred.thestorm.rwf.app.ObservationSource;
import com.shepherdjerred.thestorm.rwf.app.view.MatchState;
import com.shepherdjerred.thestorm.rwfbots.domain.difficulty.LeverCurves;
import com.shepherdjerred.thestorm.rwfbots.domain.learning.FairObservation;
import com.shepherdjerred.thestorm.rwfbots.domain.learning.ObservationContract;
import com.shepherdjerred.thestorm.rwfbots.domain.perception.Perception;
import com.shepherdjerred.thestorm.rwfbots.domain.perception.PerceptionState;
import com.shepherdjerred.thestorm.rwfbots.domain.perception.SenseContext;
import com.shepherdjerred.thestorm.rwfbots.domain.world.WorldSnapshot;
import java.util.HashMap;
import java.util.Map;
import java.util.Optional;
import java.util.SplittableRandom;
import java.util.UUID;
import org.bukkit.Server;
import org.jspecify.annotations.Nullable;

/**
 * A separate capture never drains the authored controller's stimuli or alters its velocity history.
 */
public final class LearningObservations implements ObservationSource {
  private final Roster roster;
  private final MatchView view;
  private final Server server;
  private final ObservationContract contract;
  private @Nullable UUID matchId;
  private @Nullable SnapshotCapture capture;
  private @Nullable WorldSnapshot snapshot;
  private final Map<UUID, PerceptionState> memories = new HashMap<>();
  private final Map<UUID, SplittableRandom> random = new HashMap<>();

  public LearningObservations(
      Roster roster, MatchView view, Server server, ObservationContract contract) {
    this.roster = roster;
    this.view = view;
    this.server = server;
    this.contract = contract;
  }

  @Override
  public Optional<Sample> capture(UUID player) {
    var session = roster.session();
    var state = view.current().map(MatchState::of);
    if (session.isEmpty()
        || state.isEmpty()
        || state.orElseThrow().phase() != MatchState.Phase.LIVE) return Optional.empty();
    var match = session.orElseThrow();
    if (!match.matchId().equals(matchId)) {
      matchId = match.matchId();
      capture = new SnapshotCapture(match.ids(), roster::anyEntity, new StimulusCollector());
      snapshot = null;
      memories.clear();
      random.clear();
    }
    var reader = capture;
    if (reader == null) throw new IllegalStateException("learning capture missing");
    var current = snapshot;
    if (current == null || current.tick() != server.getCurrentTick()) {
      current = reader.capture(server.getCurrentTick(), state.orElseThrow());
      snapshot = current;
      for (var fighter : current.combatants()) {
        if (!fighter.alive()) match.ids().uuid(fighter.id()).ifPresent(memories::remove);
      }
    }
    var self = current.combatant(match.ids().combatant(player));
    if (self.isEmpty() || !self.orElseThrow().alive()) return Optional.empty();
    var levers = LeverCurves.at(1);
    var nav = match.nav();
    var perceiver =
        new Perception(new SenseContext(nav.grid(), nav.graph(), nav.regions(), levers));
    var percept =
        perceiver.perceive(
            memories.getOrDefault(player, PerceptionState.EMPTY),
            self.orElseThrow(),
            current,
            random.computeIfAbsent(
                player,
                id ->
                    new SplittableRandom(
                        match.seed()
                            ^ id.getMostSignificantBits()
                            ^ id.getLeastSignificantBits())));
    memories.put(player, percept.state());
    return Optional.of(
        new Sample(
            ObservationContract.ID,
            contract.encode(
                FairObservation.values(self.orElseThrow(), percept, nav.grid(), levers))));
  }
}
