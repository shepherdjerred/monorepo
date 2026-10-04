package com.shepherdjerred.thestorm.rwf.adapter.paper;

import com.shepherdjerred.thestorm.rwf.app.MatchRecording;
import com.shepherdjerred.thestorm.rwf.app.Pseudonyms;
import com.shepherdjerred.thestorm.rwf.app.Recorder;
import com.shepherdjerred.thestorm.rwf.app.RecordingSummary;
import com.shepherdjerred.thestorm.rwf.domain.combat.CombatRules;
import com.shepherdjerred.thestorm.rwf.domain.combatant.CombatantId;
import com.shepherdjerred.thestorm.rwf.domain.combatant.TeamColor;
import com.shepherdjerred.thestorm.rwf.domain.map.MapDefinition;
import com.shepherdjerred.thestorm.rwf.domain.match.Combatant;
import com.shepherdjerred.thestorm.rwf.domain.match.RwfMatch;
import com.shepherdjerred.thestorm.rwf.domain.record.Frame;
import com.shepherdjerred.thestorm.rwf.domain.record.InputFrame;
import com.shepherdjerred.thestorm.rwf.domain.record.Intent;
import com.shepherdjerred.thestorm.rwf.domain.record.MatchRecord;
import com.shepherdjerred.thestorm.rwf.domain.record.RecordEnd;
import com.shepherdjerred.thestorm.rwf.domain.record.RecordEvent;
import com.shepherdjerred.thestorm.rwf.domain.record.RecordHeader;
import com.shepherdjerred.thestorm.rwf.domain.record.RosterEntry;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Map;
import java.util.Optional;
import java.util.TreeMap;
import java.util.concurrent.CompletableFuture;
import org.bukkit.entity.Player;
import org.jspecify.annotations.Nullable;

/**
 * Turns match happenings into record rows under pseudonyms and hands them to the {@link Recorder}.
 * Disabled recordings accept everything and write nothing. Main thread only.
 */
final class Recordings {

  /** Ticks since the match went live, at the server's 50 ms tick. */
  static long tick(Instant liveAt, Instant now) {
    return Math.max(0, Duration.between(liveAt, now).toMillis() / 50);
  }

  private final Recorder recorder;
  private final Optional<Pseudonyms> pseudonyms;
  private final Inputs inputs;
  private @Nullable MatchRecording recording;
  private @Nullable Instant liveAt;

  Recordings(Recorder recorder, Optional<Pseudonyms> pseudonyms, Inputs inputs) {
    this.recorder = recorder;
    this.pseudonyms = pseudonyms;
    this.inputs = inputs;
  }

  boolean enabled() {
    return pseudonyms.isPresent();
  }

  boolean active() {
    return recording != null;
  }

  /** The pseudonym of {@code id}; empty when recording is off. */
  Optional<String> pseudonym(CombatantId id) {
    return pseudonyms.map(p -> p.of(id.uuid()));
  }

  /** The match went live: opens the recording with its roster. */
  void start(RwfMatch match, MapDefinition map, Instant now) {
    if (pseudonyms.isEmpty() || recording != null) {
      return;
    }
    var roster = new ArrayList<RosterEntry>();
    for (var member : match.members()) {
      roster.add(
          new RosterEntry(
              pseudonym(member.id()).orElseThrow(),
              member.team().orElseThrow(),
              member.kit().orElseThrow(),
              member.id().isBot()));
    }
    liveAt = now;
    recording =
        recorder.begin(
            new RecordHeader(
                MatchRecord.SCHEMA_VERSION,
                match.matchId(),
                map.id(),
                map.blocksSha256(),
                match.seed(),
                roster,
                CombatRules.COMBAT_RULES_VERSION));
  }

  private long tick(Instant now) {
    var live = liveAt;
    return live == null ? 0 : tick(live, now);
  }

  void event(Instant now, String kind, CombatantId subject, String detail) {
    event(now, kind, pseudonym(subject).orElse(""), detail);
  }

  void event(Instant now, String kind, String subject, String detail) {
    var current = recording;
    if (current != null && !subject.isEmpty()) {
      current.event(new RecordEvent(tick(now), kind, subject, detail));
    }
  }

  /**
   * Samples a living member on server tick {@code serverTick}: a frame when one is due ({@link
   * Frame#due}), and for a human also the keys they hold and their exact rotation, every tick.
   */
  void sample(Instant now, long serverTick, Combatant member, Player player) {
    var current = recording;
    if (current == null) {
      return;
    }
    var bot = member.id().isBot();
    if (!Frame.due(bot, serverTick)) {
      return;
    }
    var tick = tick(now);
    var pseudonym = pseudonym(member.id()).orElseThrow();
    var location = Places.at(player);
    var flags =
        (player.isSneaking() ? Frame.SNEAKING : 0)
            | (player.isSprinting() ? Frame.SPRINTING : 0)
            | (player.getFireTicks() > 0 ? Frame.ON_FIRE : 0)
            | (player.isBlocking() ? Frame.BLOCKING : 0);
    current.frame(
        new Frame(
            tick,
            pseudonym,
            Frame.quantizePosition(location.getX()),
            Frame.quantizePosition(location.getY()),
            Frame.quantizePosition(location.getZ()),
            Frame.quantizeYaw(location.getYaw()),
            Frame.quantizePitch(location.getPitch()),
            Frame.quantizeHealth(player.getHealth()),
            player.getInventory().getHeldItemSlot(),
            flags));
    if (!bot) {
      current.input(
          new InputFrame(
              tick,
              pseudonym,
              inputs.keys(player.getUniqueId()),
              InputFrame.quantizeYaw(location.getYaw()),
              InputFrame.quantizePitch(location.getPitch())));
    }
  }

  void intent(Instant now, CombatantId who, String kind, String target) {
    var current = recording;
    if (current != null) {
      current.intent(new Intent(tick(now), pseudonym(who).orElseThrow(), kind, target));
    }
  }

  /** Closes the recording; empty when none was open. */
  Optional<CompletableFuture<RecordingSummary>> end(
      Instant now,
      Optional<TeamColor> winner,
      RecordEnd.Reason reason,
      Map<CombatantId, Long> payouts) {
    var current = recording;
    if (current == null) {
      return Optional.empty();
    }
    recording = null;
    liveAt = null;
    var byPseudonym = new TreeMap<String, Long>();
    payouts.forEach((id, credits) -> byPseudonym.put(pseudonym(id).orElseThrow(), credits));
    return Optional.of(current.end(new RecordEnd(tick(now), winner, reason, byPseudonym)));
  }
}
