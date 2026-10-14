package com.shepherdjerred.thestorm.rwf.adapter.paper;

import com.shepherdjerred.thestorm.rwf.app.MatchRecording;
import com.shepherdjerred.thestorm.rwf.app.Pseudonyms;
import com.shepherdjerred.thestorm.rwf.app.Recorder;
import com.shepherdjerred.thestorm.rwf.app.RecordingSummary;
import com.shepherdjerred.thestorm.rwf.domain.combat.CombatRules;
import com.shepherdjerred.thestorm.rwf.domain.combatant.CombatantId;
import com.shepherdjerred.thestorm.rwf.domain.combatant.TeamColor;
import com.shepherdjerred.thestorm.rwf.domain.geometry.BlockPos;
import com.shepherdjerred.thestorm.rwf.domain.geometry.Vec3;
import com.shepherdjerred.thestorm.rwf.domain.map.MapDefinition;
import com.shepherdjerred.thestorm.rwf.domain.match.Combatant;
import com.shepherdjerred.thestorm.rwf.domain.match.RwfMatch;
import com.shepherdjerred.thestorm.rwf.domain.poison.PoisonClock;
import com.shepherdjerred.thestorm.rwf.domain.record.Frame;
import com.shepherdjerred.thestorm.rwf.domain.record.Intent;
import com.shepherdjerred.thestorm.rwf.domain.record.MatchRecord;
import com.shepherdjerred.thestorm.rwf.domain.record.Occurrence;
import com.shepherdjerred.thestorm.rwf.domain.record.RecordEnd;
import com.shepherdjerred.thestorm.rwf.domain.record.RecordEvent;
import com.shepherdjerred.thestorm.rwf.domain.record.RecordHeader;
import com.shepherdjerred.thestorm.rwf.domain.record.RosterEntry;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.OptionalDouble;
import java.util.Set;
import java.util.TreeMap;
import java.util.concurrent.CompletableFuture;
import org.bukkit.entity.Player;
import org.jspecify.annotations.Nullable;

/**
 * Turns match happenings into record rows under pseudonyms and hands them to the {@link Recorder}.
 * Disabled recordings accept everything and write nothing. Main thread only.
 */
final class Recordings {

  private final Recorder recorder;
  private final Optional<Pseudonyms> pseudonyms;
  private final Inputs inputs;
  private final com.shepherdjerred.thestorm.core.module.Services services;
  private final org.bukkit.plugin.Plugin plugin;
  private final Set<String> rosteredBots = new HashSet<>();
  private long liveTick;
  private long lastPulse = -1;
  private @Nullable MatchRecording recording;

  record Parts(
      Recorder recorder,
      Optional<Pseudonyms> pseudonyms,
      Inputs inputs,
      com.shepherdjerred.thestorm.core.module.Services services,
      org.bukkit.plugin.Plugin plugin) {}

  Recordings(Parts parts) {
    this.recorder = parts.recorder();
    this.pseudonyms = parts.pseudonyms();
    this.inputs = parts.inputs();
    this.services = parts.services();
    this.plugin = parts.plugin();
  }

  boolean enabled() {
    return pseudonyms.isPresent();
  }

  boolean active() {
    return recording != null;
  }

  List<String> status(Player player) {
    var lines = new ArrayList<String>();
    var state = enabled() ? "enabled; waiting for a match" : "disabled";
    if (active()) state = "active";
    lines.add("Match recording: " + state + ".");
    lines.addAll(inputs.recordingStatus(player));
    lines.add(
        "Training requires manual Trooper duels; whole-match eligibility is checked after recording.");
    return List.copyOf(lines);
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
    rosteredBots.clear();
    lastPulse = -1;
    for (var member : match.members()) {
      if (member.id().isBot()) {
        rosteredBots.add(pseudonym(member.id()).orElseThrow());
      }
      roster.add(
          new RosterEntry(
              pseudonym(member.id()).orElseThrow(),
              member.team().orElseThrow(),
              member.kit().orElseThrow(),
              member.id().isBot()));
    }
    liveTick = plugin.getServer().getCurrentTick();
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

  private long tick() {
    return Math.max(0, plugin.getServer().getCurrentTick() - liveTick);
  }

  void event(Instant now, String kind, CombatantId subject, String detail) {
    event(now, kind, pseudonym(subject).orElse(""), detail);
  }

  void event(Instant now, String kind, String subject, String detail) {
    var current = recording;
    if (current != null && !subject.isEmpty()) {
      current.event(new RecordEvent(tick(), kind, subject, detail));
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
    var tick = tick();
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
      current.input(inputs.frame(tick, pseudonym, player, liveTick));
      services
          .find(com.shepherdjerred.thestorm.rwf.app.ObservationSource.class)
          .flatMap(source -> source.capture(player.getUniqueId()))
          .ifPresent(
              sample -> {
                current.observation(
                    new com.shepherdjerred.thestorm.rwf.domain.record.ObservationFrame(
                        tick, pseudonym, sample.contract(), sample.values()));
                player.sendPluginMessage(
                    plugin,
                    com.shepherdjerred.thestorm.rwf.domain.record.ObservationPacket.CHANNEL,
                    com.shepherdjerred.thestorm.rwf.domain.record.ObservationPacket.encode(
                        plugin.getServer().getCurrentTick(), sample.values()));
              });
    }
  }

  void intent(Instant now, CombatantId who, String kind, String target) {
    var current = recording;
    if (current != null) {
      current.intent(new Intent(tick(), pseudonym(who).orElseThrow(), kind, target));
    }
  }

  // ---- schema 4 occurrences --------------------------------------------------------------------
  // Each is a no-op while no match is being recorded. Names are turned into pseudonyms here.

  /** The match changed a block, or put one back. */
  void blockChange(BlockPos at, String state, Occurrence.BlockChange.Reason reason) {
    occur(tick -> new Occurrence.BlockChange(tick, at.x(), at.y(), at.z(), state, reason));
  }

  /** {@code shooter} launched a projectile of {@code kind} from {@code at} at {@code velocity}. */
  void projectile(CombatantId shooter, String kind, Vec3 at, Vec3 velocity) {
    occur(
        tick ->
            new Occurrence.Projectile(
                tick,
                name(shooter),
                kind,
                at.x(),
                at.y(),
                at.z(),
                velocity.x(),
                velocity.y(),
                velocity.z()));
  }

  /** {@code user} used {@code ability}, aimed at another combatant. */
  void ability(CombatantId user, String ability, CombatantId target) {
    occur(tick -> new Occurrence.AbilityUse(tick, name(user), ability, Optional.of(name(target))));
  }

  /** {@code user} used {@code ability}, aimed at a bomb or spot ({@code target}), or at nothing. */
  void ability(CombatantId user, String ability, Optional<String> target) {
    occur(tick -> new Occurrence.AbilityUse(tick, name(user), ability, target));
  }

  /** {@code subject} was given {@code effect} at {@code amplifier} for {@code durationTicks}. */
  void effect(CombatantId subject, String effect, int amplifier, int durationTicks) {
    occur(
        tick ->
            new Occurrence.EffectApplied(tick, name(subject), effect, amplifier, durationTicks));
  }

  /** {@code earner} earned the {@code streak} reward at {@code kills}. */
  void killstreak(CombatantId earner, String streak, int kills) {
    occur(tick -> new Occurrence.Killstreak(tick, name(earner), streak, kills));
  }

  /**
   * {@code speaker} said {@code text} in {@code channel} ({@code global}, {@code team}, {@code
   * dead}). A human's words are never recorded, only the channel and length; a rostered bot's line
   * is recorded in full.
   */
  void chat(CombatantId speaker, String channel, String text) {
    if (text.isEmpty()) {
      return;
    }
    occur(
        tick -> {
          var pseudonym = name(speaker);
          var bot = speaker.isBot() && rosteredBots.contains(pseudonym);
          return new Occurrence.Chat(
              tick, pseudonym, channel, text.length(), bot ? Optional.of(text) : Optional.empty());
        });
  }

  /**
   * How the map vote came out: each candidate map in ballot order with its votes, and the map
   * chosen. Call it once the match is live; it is recorded at the current tick (0 at the start).
   */
  void ballot(List<Occurrence.Ballot.Candidate> votes, String chosen) {
    occur(tick -> new Occurrence.Ballot(tick, votes, chosen));
  }

  /**
   * A death as the recording keeps it.
   *
   * @param victim who died
   * @param killer who is credited, if anyone
   * @param cause the attack type's name ({@code AttackType#name()})
   * @param weapon the killer's weapon id ({@code iron_sword}, {@code arrow}), when known
   * @param distance blocks between killer and victim, when known
   * @param assists everyone else who hurt the victim, with their share of the damage (0 to 1]
   */
  record Death(
      CombatantId victim,
      Optional<CombatantId> killer,
      String cause,
      Optional<String> weapon,
      OptionalDouble distance,
      Map<CombatantId, Double> assists) {}

  /** A combatant died; see {@link Death}. */
  void kill(Death death) {
    occur(
        tick -> {
          var shares = new TreeMap<String, Double>();
          death.assists().forEach((who, share) -> shares.put(name(who), share));
          return new Occurrence.Kill(
              tick,
              name(death.victim()),
              death.killer().map(this::name),
              death.cause(),
              death.weapon(),
              death.distance(),
              shares);
        });
  }

  /** Whether a {@link #pulse} is due now: every five seconds of the live match, once. */
  boolean pulseDue() {
    return recording != null && Occurrence.Pulse.due(tick()) && tick() != lastPulse;
  }

  /** The periodic picture of the match; call it when {@link #pulseDue()}. */
  void pulse(
      Map<TeamColor, Integer> alive,
      Map<String, Occurrence.Pulse.BombStatus> bombs,
      PoisonClock.Stage poison) {
    occur(
        tick -> {
          lastPulse = tick;
          return new Occurrence.Pulse(tick, alive, bombs, poison);
        });
  }

  private void occur(java.util.function.LongFunction<Occurrence> row) {
    var current = recording;
    if (current != null) {
      current.occurrence(row.apply(tick()));
    }
  }

  private String name(CombatantId id) {
    return pseudonym(id).orElseThrow();
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
    var endedAt = tick();
    recording = null;
    var byPseudonym = new TreeMap<String, Long>();
    payouts.forEach((id, credits) -> byPseudonym.put(pseudonym(id).orElseThrow(), credits));
    return Optional.of(current.end(new RecordEnd(endedAt, winner, reason, byPseudonym)));
  }
}
