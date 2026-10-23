package com.shepherdjerred.thestorm.rwf.adapter.paper;

import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.core.module.Services;
import com.shepherdjerred.thestorm.rwf.app.MatchRecording;
import com.shepherdjerred.thestorm.rwf.app.Pseudonyms;
import com.shepherdjerred.thestorm.rwf.app.Recorder;
import com.shepherdjerred.thestorm.rwf.app.RecordingSummary;
import com.shepherdjerred.thestorm.rwf.domain.combat.AttackType;
import com.shepherdjerred.thestorm.rwf.domain.combatant.CombatantId;
import com.shepherdjerred.thestorm.rwf.domain.combatant.TeamColor;
import com.shepherdjerred.thestorm.rwf.domain.kit.KitAccess;
import com.shepherdjerred.thestorm.rwf.domain.match.Ballot;
import com.shepherdjerred.thestorm.rwf.domain.match.MatchEvent;
import com.shepherdjerred.thestorm.rwf.domain.match.MatchSettings;
import com.shepherdjerred.thestorm.rwf.domain.match.RwfMatch;
import com.shepherdjerred.thestorm.rwf.domain.record.Frame;
import com.shepherdjerred.thestorm.rwf.domain.record.InputFrame;
import com.shepherdjerred.thestorm.rwf.domain.record.Intent;
import com.shepherdjerred.thestorm.rwf.domain.record.ObservationFrame;
import com.shepherdjerred.thestorm.rwf.domain.record.Occurrence;
import com.shepherdjerred.thestorm.rwf.domain.record.RecordCodec;
import com.shepherdjerred.thestorm.rwf.domain.record.RecordEnd;
import com.shepherdjerred.thestorm.rwf.domain.record.RecordEvent;
import com.shepherdjerred.thestorm.rwf.domain.record.RecordHeader;
import com.shepherdjerred.thestorm.rwf.testing.Samples;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.mockbukkit.mockbukkit.MockBukkit;

/** A landed hit between members becomes a {@code hit} event row in the match recording. */
final class RecordingsHitTest {

  private static final CombatantId ARCHER = new CombatantId.Bot("archer", new UUID(1, 1));
  private static final CombatantId TARGET = new CombatantId.Bot("target", new UUID(2, 2));

  private final List<RecordEvent> events = new ArrayList<>();

  @AfterEach
  void stop() {
    MockBukkit.unmock();
  }

  @Test
  void aProjectileHitIsRecordedUnderPseudonymsWithItsClassCauseAndDamage() {
    MockBukkit.mock();
    var pseudonyms = new Pseudonyms("salt");
    var recordings = recordings(Optional.of(pseudonyms));
    recordings.start(live(), Samples.twoTeams(), Samples.T0);

    recordings.hit(ARCHER, TARGET, AttackType.PROJECTILE, 4.5);
    recordings.hit(TARGET, ARCHER, AttackType.MELEE, 1);

    var archer = pseudonyms.of(ARCHER.uuid());
    var target = pseudonyms.of(TARGET.uuid());
    assertThat(events)
        .filteredOn(event -> RecordEvent.HIT.equals(event.kind()))
        .containsExactly(
            new RecordEvent(0, "hit", archer, target + ";projectile;Projectile;4.50"),
            new RecordEvent(0, "hit", target, archer + ";melee;Melee;1.00"));
    var row = String.join("\t", "E", "0", "hit", target, archer + ";melee;Melee;1.00") + "\n";
    assertThat(RecordCodec.event(events.getLast())).isEqualTo(row);
  }

  @Test
  void nothingIsWrittenWhileNoMatchIsRecorded() {
    MockBukkit.mock();
    var recordings = recordings(Optional.of(new Pseudonyms("salt")));
    recordings.hit(ARCHER, TARGET, AttackType.PROJECTILE, 4.5);
    assertThat(events).isEmpty();
  }

  private Recordings recordings(Optional<Pseudonyms> pseudonyms) {
    return new Recordings(
        new Recordings.Parts(
            new Capture(),
            pseudonyms,
            new Inputs(),
            new Services(),
            MockBukkit.createMockPlugin("TheStorm")));
  }

  private static RwfMatch live() {
    var match = RwfMatch.open(MatchSettings.RED_WARFARE, Samples.MATCH, Samples.SEED);
    var map = Samples.twoTeams();
    for (var event :
        List.<MatchEvent>of(
            new MatchEvent.Join(ARCHER, "Archer", Samples.T0),
            new MatchEvent.Join(TARGET, "Target", Samples.T0),
            new MatchEvent.BallotOpened(
                List.of(
                    new Ballot.Candidate(map.id(), map.name(), map.author()),
                    new Ballot.Candidate("yard", "Yard", map.author()))),
            new MatchEvent.PickKit(ARCHER, "longbow", KitAccess.MILESTONE_ONE),
            new MatchEvent.PickKit(TARGET, "trooper", KitAccess.MILESTONE_ONE),
            new MatchEvent.Vote(ARCHER, map.id()),
            new MatchEvent.AssignTeam(ARCHER, TeamColor.RED),
            new MatchEvent.AssignTeam(TARGET, TeamColor.BLUE),
            new MatchEvent.ForceStart(Samples.T0),
            new MatchEvent.MapReady(map, Samples.T0))) {
      match =
          match
              .on(event)
              .fold(
                  step -> step.match(),
                  error -> {
                    throw new AssertionError(event + " was refused: " + error);
                  });
    }
    return match;
  }

  /** Keeps the events a recording is given. */
  private final class Capture implements Recorder, MatchRecording {

    @Override
    public MatchRecording begin(RecordHeader header) {
      return this;
    }

    @Override
    public CompletableFuture<Void> close(Duration timeout) {
      return CompletableFuture.completedFuture(null);
    }

    @Override
    public void event(RecordEvent event) {
      events.add(event);
    }

    @Override
    public void frame(Frame frame) {}

    @Override
    public void input(InputFrame input) {}

    @Override
    public void observation(ObservationFrame observation) {}

    @Override
    public void intent(Intent intent) {}

    @Override
    public void occurrence(Occurrence occurrence) {}

    @Override
    public CompletableFuture<RecordingSummary> end(RecordEnd end) {
      return CompletableFuture.completedFuture(RecordingSummary.NONE);
    }
  }
}
