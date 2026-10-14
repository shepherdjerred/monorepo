package com.shepherdjerred.thestorm.rwfbots.adapter.paper;

import com.shepherdjerred.thestorm.rwf.app.TacticalReports;
import com.shepherdjerred.thestorm.rwf.app.VisualOcclusion;
import com.shepherdjerred.thestorm.rwf.app.view.MatchState;
import com.shepherdjerred.thestorm.rwfbots.app.ThinkLoop;
import com.shepherdjerred.thestorm.rwfbots.domain.geom.Vec3;
import com.shepherdjerred.thestorm.rwfbots.domain.perception.SightCloud;
import com.shepherdjerred.thestorm.rwfbots.domain.team.SensorClue;
import java.time.Duration;
import java.time.InstantSource;
import java.util.List;

/** Captures shared tactical ports on the main thread; no Paper callback reaches a worker. */
final class TacticalObservations {
  private final VisualOcclusion vision;
  private final TacticalReports reports;
  private final InstantSource time;
  private long cursor;
  private java.util.Optional<java.util.UUID> match = java.util.Optional.empty();

  record Parts(VisualOcclusion vision, TacticalReports reports, InstantSource time) {}

  TacticalObservations(Parts parts) {
    vision = parts.vision();
    reports = parts.reports();
    time = parts.time();
  }

  List<SightCloud> capture(ThinkLoop loop, MatchState state, long tick) {
    if (!match.equals(java.util.Optional.of(state.matchId()))) {
      match = java.util.Optional.of(state.matchId());
      var old = reports.since(cursor);
      if (!old.isEmpty()) cursor = old.getLast().sequence();
    }
    var clouds =
        vision.snapshot().stream()
            .map(
                field ->
                    new SightCloud(
                        new Vec3(field.center().x(), field.center().y(), field.center().z()),
                        field.radius()))
            .toList();
    loop.observedSmoke(clouds);
    for (var cue : reports.since(cursor)) {
      cursor = cue.sequence();
      var report = cue.report();
      var owner =
          state.combatants().stream()
              .filter(fighter -> fighter.uuid().equals(report.reporter()) && fighter.alive())
              .findFirst()
              .flatMap(MatchState.Fighter::team);
      var age = Math.max(0, Duration.between(cue.at(), time.instant()).toMillis() / 50);
      if (owner.isPresent() && age <= 80)
        loop.sensor(
            IdMap.team(owner.orElseThrow()),
            new SensorClue(
                new Vec3(report.position().x(), report.position().y(), report.position().z()),
                report.uncertainty(),
                Math.max(0, tick - age)));
    }
    return clouds;
  }
}
