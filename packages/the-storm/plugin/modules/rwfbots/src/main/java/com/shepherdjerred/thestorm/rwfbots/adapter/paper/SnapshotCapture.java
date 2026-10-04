package com.shepherdjerred.thestorm.rwfbots.adapter.paper;

import com.shepherdjerred.thestorm.rwf.app.view.MatchState;
import com.shepherdjerred.thestorm.rwfbots.domain.geom.Vec3;
import com.shepherdjerred.thestorm.rwfbots.domain.world.BombOwner;
import com.shepherdjerred.thestorm.rwfbots.domain.world.BombState;
import com.shepherdjerred.thestorm.rwfbots.domain.world.BombView;
import com.shepherdjerred.thestorm.rwfbots.domain.world.CombatantView;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Kit;
import com.shepherdjerred.thestorm.rwfbots.domain.world.MatchPhase;
import com.shepherdjerred.thestorm.rwfbots.domain.world.PoisonView;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Stimulus;
import com.shepherdjerred.thestorm.rwfbots.domain.world.WorldSnapshot;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.function.Function;
import org.bukkit.Location;
import org.bukkit.attribute.Attribute;
import org.bukkit.entity.Player;

/**
 * Builds the bots' {@link WorldSnapshot} each tick from rwf's read model and the live entities:
 * position, velocity (from the position a tick ago), look, health, absorption, armor, held slot,
 * sprinting, on ground, using an item, invisible and when they were last hurt (a drop in health
 * plus absorption), with the bombs, the poison and the tick's stimuli. A combatant whose entity is
 * absent this tick (a bot between bodies while its skin applies, a human not online) is left out of
 * the snapshot rather than guessed at. Main thread only.
 */
public final class SnapshotCapture {

  /** Sprinting combatants make a footstep every this many ticks. */
  public static final int FOOTSTEP_EVERY_TICKS = 10;

  /** Poison intensity grows by this much per tick once it is hurting. */
  public static final double POISON_RAMP_PER_TICK = 1.0 / 1200;

  /** What a capture remembers about one combatant between ticks. */
  private record Last(Vec3 pos, double effectiveHealth, long hurtTick) {}

  private final IdMap ids;
  private final Function<UUID, Optional<Player>> entities;
  private final StimulusCollector stimuli;
  private final Map<UUID, Last> last = new HashMap<>();
  private long poisonStartedTick = -1;

  /**
   * @param ids the match's id mapping
   * @param entities resolves a combatant's entity (bots through their bodies, humans by server)
   * @param stimuli where the tick's raw events wait
   */
  public SnapshotCapture(
      IdMap ids, Function<UUID, Optional<Player>> entities, StimulusCollector stimuli) {
    this.ids = ids;
    this.entities = entities;
    this.stimuli = stimuli;
  }

  /** The world at {@code tick}, as rwf's {@code state} and the entities describe it. */
  public WorldSnapshot capture(long tick, MatchState state) {
    var combatants = new ArrayList<CombatantView>();
    var present = new HashMap<UUID, Player>();
    for (var fighter : state.combatants()) {
      var entity = entities.apply(fighter.uuid());
      if (entity.isEmpty()) {
        continue;
      }
      present.put(fighter.uuid(), entity.orElseThrow());
      combatants.add(view(tick, fighter, entity.orElseThrow()));
    }
    last.keySet().retainAll(present.keySet());
    var bombs = state.bombs().stream().map(this::bomb).toList();
    var mapId =
        state.mapId().orElseThrow(() -> new IllegalStateException("a live match has a map"));
    return new WorldSnapshot(
        tick,
        phase(state.phase()),
        combatants,
        bombs,
        poison(tick, state),
        mapId,
        stimuli(tick, present));
  }

  private CombatantView view(long tick, MatchState.Fighter fighter, Player entity) {
    var location = Places.at(entity);
    var pos = vec(location);
    var health = Math.clamp(entity.getHealth(), 0, CombatantView.MAX_HEALTH);
    var absorption = Math.max(0, entity.getAbsorptionAmount());
    var previous = last.get(fighter.uuid());
    var velocity = previous == null ? Vec3.ZERO : pos.minus(previous.pos());
    var hurtTick = previous == null ? -1 : previous.hurtTick();
    if (previous != null && health + absorption < previous.effectiveHealth() - 1.0e-6) {
      hurtTick = tick;
    }
    last.put(fighter.uuid(), new Last(pos, health + absorption, hurtTick));
    var kit = kit(fighter);
    return new CombatantView(
        ids.combatant(fighter.uuid()),
        IdMap.team(
            fighter
                .team()
                .orElseThrow(() -> new IllegalStateException(fighter.name() + " has no team"))),
        kit.isDisguiseKit(),
        kit,
        fighter.alive() && !entity.isDead(),
        pos,
        velocity,
        location.getYaw(),
        Math.clamp(location.getPitch(), -90, 90),
        health,
        absorption,
        armor(entity),
        entity.getInventory().getHeldItemSlot(),
        entity.isSprinting(),
        onGround(entity),
        entity.isHandRaised(),
        entity.isInvisible(),
        hurtTick);
  }

  private static Kit kit(MatchState.Fighter fighter) {
    var id =
        fighter.kit().orElseThrow(() -> new IllegalStateException(fighter.name() + " has no kit"));
    return Kit.valueOf(id.toUpperCase(Locale.ROOT));
  }

  /**
   * Whether the entity stands on something: the block just under its feet is solid. The server's
   * own on-ground flag is client-reported for players and deprecated, so it is not read.
   */
  public static boolean onGround(Player entity) {
    var feet = Places.at(entity);
    return feet.clone().subtract(0, 0.05, 0).getBlock().getType().isSolid();
  }

  /** The armor attribute, which an entity without the attribute registered has none of. */
  private static double armor(Player entity) {
    var attribute = entity.getAttribute(Attribute.ARMOR);
    return attribute == null ? 0 : Math.clamp(attribute.getValue(), 0, 20);
  }

  private BombView bomb(MatchState.Bomb bomb) {
    BombOwner owner =
        bomb.nuke()
            ? new BombOwner.Nuke()
            : new BombOwner.Team(
                IdMap.team(
                    bomb.team()
                        .orElseThrow(
                            () -> new IllegalStateException(bomb.id() + " has no owner"))));
    return new BombView(
        ids.bomb(bomb.id()),
        owner,
        new Vec3(bomb.x() + 0.5, bomb.y() + 0.5, bomb.z() + 0.5),
        state(bomb.status()));
  }

  private static BombState state(MatchState.Status status) {
    return switch (status) {
      case MatchState.Status.Idle _ -> new BombState.Idle();
      case MatchState.Status.Working working ->
          new BombState.Arming(
              IdMap.team(working.team()), working.progress(), working.clickers().size());
      case MatchState.Status.Armed armed -> {
        var ticks = armed.remainingSeconds() * 20L;
        yield armed
            .defusing()
            .<BombState>map(
                defusing ->
                    new BombState.Defusing(defusing.progress(), defusing.clickers().size(), ticks))
            .orElseGet(() -> new BombState.Armed(ticks));
      }
      case MatchState.Status.Destroyed _ -> new BombState.Destroyed();
    };
  }

  private PoisonView poison(long tick, MatchState state) {
    var deadly = state.poison().map(MatchState.Poison::deadly).orElse(false);
    if (!deadly) {
      poisonStartedTick = -1;
      return PoisonView.NONE;
    }
    if (poisonStartedTick < 0) {
      poisonStartedTick = tick;
    }
    return PoisonView.startedAt(
        poisonStartedTick, (tick - poisonStartedTick) * POISON_RAMP_PER_TICK);
  }

  private List<Stimulus> stimuli(long tick, Map<UUID, Player> present) {
    var result = new ArrayList<Stimulus>();
    if (tick % FOOTSTEP_EVERY_TICKS == 0) {
      for (var entity : present.values()) {
        if (entity.isSprinting()) {
          stimuli.footstep(entity);
        }
      }
    }
    for (var raw : stimuli.drain()) {
      if (!present.containsKey(raw.source())) {
        continue;
      }
      var source = ids.combatant(raw.source());
      var victim = raw.victim().filter(present::containsKey).map(ids::combatant);
      if (raw.kind() == Stimulus.Kind.HIT && victim.isEmpty()) {
        continue;
      }
      result.add(new Stimulus(raw.kind(), vec(raw.at()), tick, Optional.of(source), victim));
    }
    return result;
  }

  static MatchPhase phase(MatchState.Phase phase) {
    return switch (phase) {
      case LOBBY, COUNTDOWN -> MatchPhase.WAITING;
      case LIVE -> MatchPhase.LIVE;
      case ENDED, RESETTING -> MatchPhase.OVER;
    };
  }

  static Vec3 vec(Location location) {
    return new Vec3(location.getX(), location.getY(), location.getZ());
  }
}
