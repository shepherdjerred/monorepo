package com.shepherdjerred.thestorm.rwfbots.adapter.paper;

import com.shepherdjerred.thestorm.rwf.app.view.MatchState;
import com.shepherdjerred.thestorm.rwfbots.domain.geom.Vec3;
import com.shepherdjerred.thestorm.rwfbots.domain.tactics.Resupply;
import com.shepherdjerred.thestorm.rwfbots.domain.world.BombOwner;
import com.shepherdjerred.thestorm.rwfbots.domain.world.BombState;
import com.shepherdjerred.thestorm.rwfbots.domain.world.BombView;
import com.shepherdjerred.thestorm.rwfbots.domain.world.CombatantView;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Kit;
import com.shepherdjerred.thestorm.rwfbots.domain.world.MatchPhase;
import com.shepherdjerred.thestorm.rwfbots.domain.world.PoisonView;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Stimulus;
import com.shepherdjerred.thestorm.rwfbots.domain.world.TraversalState;
import com.shepherdjerred.thestorm.rwfbots.domain.world.WorldSnapshot;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.function.Function;
import org.bukkit.Location;
import org.bukkit.Material;
import org.bukkit.attribute.Attribute;
import org.bukkit.entity.Player;

/**
 * Builds the bots' {@link WorldSnapshot} each tick from rwf's read model and the live entities:
 * position, velocity (from the position a tick ago), look, health, absorption, armor, held slot,
 * sprinting, on ground, using an item, invisible and when they were last hurt (a drop in health
 * plus absorption) and the arrows left to a weapon that spends them ({@link Quivers}), with the
 * bombs, the poison, the tick's stimuli and the loose arrows a low quiver could pick up. A
 * combatant whose entity is absent this tick (a bot between bodies while its skin applies, a human
 * not online) is left out of the snapshot rather than guessed at. Main thread only.
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
  private final TraversalCapture traversal;
  private final Capabilities capabilities;
  private final Map<UUID, SoundMotion> soundMotion = new HashMap<>();
  private boolean emitMotion = true;
  private long soundBaseline;

  private record SoundMotion(Vec3 position, boolean grounded, boolean wet) {}

  /**
   * Separate velocity/perception history, reading the same sound log without generating duplicates.
   */
  SnapshotCapture independent() {
    var capture =
        new SnapshotCapture(
            ids, entities, new StimulusCollector(stimuli.sounds(), stimuli.time()), capabilities);
    capture.emitMotion = false;
    capture.soundBaseline = soundBaseline;
    return capture;
  }

  private final Map<UUID, Last> last = new HashMap<>();
  private long poisonStartedTick = -1;

  /** The authoritative kit immunity source and the same clock used by the match rules. */
  public record Capabilities(
      Function<UUID, Optional<java.time.Instant>> noFallUntil, java.time.InstantSource time) {}

  /**
   * @param ids the match's id mapping
   * @param entities resolves a combatant's entity (bots through their bodies, humans by server)
   * @param stimuli where the tick's raw events wait
   * @param capabilities the authoritative kit immunity source and match clock
   */
  public SnapshotCapture(
      IdMap ids,
      Function<UUID, Optional<Player>> entities,
      StimulusCollector stimuli,
      Capabilities capabilities) {
    this.ids = ids;
    this.entities = entities;
    this.stimuli = stimuli;
    this.traversal = new TraversalCapture(capabilities.noFallUntil(), capabilities.time());
    this.capabilities = capabilities;
    var existing = stimuli.sounds().since(0);
    soundBaseline = existing.isEmpty() ? 0 : existing.getLast().sequence();
  }

  /** The world at {@code tick}, as rwf's {@code state} and the entities describe it. */
  public WorldSnapshot capture(long tick, MatchState state) {
    var combatants = new ArrayList<CombatantView>();
    var present = new HashMap<UUID, Player>();
    var low = new ArrayList<Player>();
    for (var fighter : state.combatants()) {
      var entity = entities.apply(fighter.uuid());
      if (entity.isEmpty()) {
        continue;
      }
      present.put(fighter.uuid(), entity.orElseThrow());
      var view = view(tick, fighter, entity.orElseThrow());
      combatants.add(view);
      if (view.alive() && Resupply.low(view.quiver())) {
        low.add(entity.orElseThrow());
      }
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
        stimuli(tick, present),
        Quivers.loose(low));
  }

  /** Actual body capabilities, using the same authoritative immunity source and match clock. */
  public TraversalState captureTraversal(Player player, String realKit, long tick) {
    return traversal.capture(player, realKit, tick);
  }

  private CombatantView view(long tick, MatchState.Fighter fighter, Player entity) {
    var location = Places.at(entity);
    var pos = vec(location);
    var kit = kitOf(fighter, Optional.of(entity));
    var traversal = captureTraversal(entity, fighter.kit().orElseThrow(), tick);
    var health = storedHealth(entity.getHealth(), traversal.maxHealth());
    var absorption = Math.max(0, entity.getAbsorptionAmount());
    var previous = last.get(fighter.uuid());
    var velocity = previous == null ? Vec3.ZERO : pos.minus(previous.pos());
    var hurtTick = previous == null ? -1 : previous.hurtTick();
    if (previous != null && health + absorption < previous.effectiveHealth() - 1.0e-6) {
      hurtTick = tick;
    }
    last.put(fighter.uuid(), new Last(pos, health + absorption, hurtTick));
    return new CombatantView(
        ids.combatant(fighter.uuid()),
        IdMap.team(
            fighter
                .team()
                .orElseThrow(() -> new IllegalStateException(fighter.name() + " has no team"))),
        fighter.disguised(),
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
        hiddenHands(entity),
        hurtTick,
        traversal,
        Quivers.of(entity));
  }

  /**
   * The body's health within its maximum. Minecraft stores health as a float clamped to the
   * float-rounded maximum, which can sit one rounding step above a fractional maximum such as a
   * Bleeder's victim has; that read once a tick threw from every bot tick and match tick while the
   * body lived, freezing every bot. Any larger excess still fails the view's contract.
   */
  static double storedHealth(double health, double maxHealth) {
    return health > maxHealth && health <= (float) maxHealth ? maxHealth : health;
  }

  /** Vanilla invisibility leaves either held item visible, for humans and NPC perception alike. */
  static boolean hiddenHands(Player entity) {
    return entity.isInvisible()
        && entity.getInventory().getItemInMainHand().getType().isAir()
        && entity.getInventory().getItemInOffHand().getType().isAir();
  }

  /**
   * The fighter's kit as bots know it. A kit bots have never heard of (a human on a newly added
   * kit, or a bot an operator put on one) reads as the known kit closest to what its entity shows,
   * so it never stops the capture or a bot's profile; with no entity nothing is shown.
   */
  static Kit kitOf(MatchState.Fighter fighter, Optional<Player> entity) {
    var id =
        fighter.kit().orElseThrow(() -> new IllegalStateException(fighter.name() + " has no kit"));
    return Kit.closest(id, entity.map(SnapshotCapture::traits).orElse(Kit.Traits.NONE));
  }

  /** What can be seen of a fighter's kit: a bow or crossbow carried, and invisibility. */
  private static Kit.Traits traits(Player entity) {
    var inventory = entity.getInventory();
    return new Kit.Traits(
        inventory.contains(Material.BOW) || inventory.contains(Material.CROSSBOW),
        entity.isInvisible());
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
            ? new BombOwner.Nuke(bomb.team().map(IdMap::team))
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
    if (emitMotion) motionSounds(tick, present);
    stimuli.drain();
    var result = new ArrayList<Stimulus>();
    var now = stimuli.time().instant();
    for (var cue : stimuli.sounds().since(soundBaseline)) {
      var sound = cue.sound();
      var entity = present.get(sound.source());
      if (entity == null || !entity.getWorld().getUID().equals(sound.world())) continue;
      var kind = soundKind(sound.kind());
      if (kind.isEmpty()) continue;
      var at = sound.position();
      var age = Math.max(0, java.time.Duration.between(cue.at(), now).toMillis() / 50);
      result.add(
          new Stimulus(
              kind.orElseThrow(),
              new Vec3(at.x(), at.y(), at.z()),
              Math.max(0, tick - age),
              Optional.of(ids.combatant(sound.source())),
              sound.victim().filter(present::containsKey).map(ids::combatant),
              cue.sequence(),
              sound.radius()));
    }
    return result;
  }

  private void motionSounds(long tick, Map<UUID, Player> present) {
    soundMotion.keySet().retainAll(present.keySet());
    for (var entity :
        present.values().stream()
            .sorted(java.util.Comparator.comparing(Player::getUniqueId))
            .toList()) {
      var position = vec(Places.at(entity));
      var grounded = onGround(entity);
      var wet = Places.at(entity).getBlock().getType() == Material.WATER;
      var before = soundMotion.put(entity.getUniqueId(), new SoundMotion(position, grounded, wet));
      if (before == null) continue;
      if (grounded && !before.grounded()) stimuli.motion(entity, Stimulus.Kind.LAND);
      if (wet && !before.wet()) stimuli.motion(entity, Stimulus.Kind.SPLASH);
      var every = entity.isSprinting() ? FOOTSTEP_EVERY_TICKS : FOOTSTEP_EVERY_TICKS * 2;
      if (grounded
          && !entity.isSneaking()
          && tick % every == 0
          && position.horizontalDistance(before.position()) > 0.03) stimuli.footstep(entity);
    }
  }

  private static Optional<Stimulus.Kind> soundKind(
      com.shepherdjerred.thestorm.rwf.app.BattleSounds.Kind kind) {
    return switch (kind) {
      case STEP -> Optional.of(Stimulus.Kind.FOOTSTEP);
      case LAND -> Optional.of(Stimulus.Kind.LAND);
      case SPLASH -> Optional.of(Stimulus.Kind.SPLASH);
      case MELEE, HURT -> Optional.of(Stimulus.Kind.HIT);
      case BOW -> Optional.of(Stimulus.Kind.BOW_SHOT);
      case EAT -> Optional.of(Stimulus.Kind.EAT);
      case FUSE -> Optional.of(Stimulus.Kind.FUSE_CLICK);
      case CHAT -> Optional.empty();
    };
  }

  static MatchPhase phase(MatchState.Phase phase) {
    return switch (phase) {
      case LOBBY, COUNTDOWN, PREPARING, PREVIEW, FREEZE -> MatchPhase.WAITING;
      case LIVE -> MatchPhase.LIVE;
      case ENDED, RESETTING -> MatchPhase.OVER;
    };
  }

  static Vec3 vec(Location location) {
    return new Vec3(location.getX(), location.getY(), location.getZ());
  }
}
