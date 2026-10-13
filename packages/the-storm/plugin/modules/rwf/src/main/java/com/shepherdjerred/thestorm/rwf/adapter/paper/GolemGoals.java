// Ported from libraryaddict's Red Warfare
// (redwarfare-arcade/src/me/libraryaddict/arcade/game/searchanddestroy/killstreak/streaks/
// IronGolemKillstreak.java and PathfinderSelector.java), with the Minecraft 1.12 goals that
// IronGolemKillstreak gave the golem; see packages/the-storm/NOTICE.
package com.shepherdjerred.thestorm.rwf.adapter.paper;

import com.destroystokyo.paper.entity.Pathfinder;
import com.destroystokyo.paper.entity.ai.Goal;
import com.destroystokyo.paper.entity.ai.GoalKey;
import com.destroystokyo.paper.entity.ai.GoalType;
import com.shepherdjerred.thestorm.rwf.domain.combatant.TeamColor;
import com.shepherdjerred.thestorm.rwf.domain.killstreak.GolemAi;
import java.util.ArrayList;
import java.util.EnumSet;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.SplittableRandom;
import java.util.UUID;
import org.bukkit.GameMode;
import org.bukkit.Location;
import org.bukkit.NamespacedKey;
import org.bukkit.block.BlockFace;
import org.bukkit.entity.Creeper;
import org.bukkit.entity.IronGolem;
import org.bukkit.entity.LivingEntity;
import org.bukkit.entity.Mob;
import org.bukkit.entity.Player;
import org.jspecify.annotations.Nullable;

/**
 * The killstreak iron golem's goals: its own are cleared and Red Warfare's put in their place, as
 * {@link GolemAi} describes, each a Paper goal. Main thread only.
 */
final class GolemGoals {

  private final Summons summons;
  private final PaperContext context;
  private final ServerHooks hooks;
  private final Map<UUID, Melee> chases = new HashMap<>();

  GolemGoals(Summons summons, PaperContext context, ServerHooks hooks) {
    this.summons = summons;
    this.context = context;
    this.hooks = hooks;
  }

  /** Gives {@code golem}, fighting for {@code team}, Red Warfare's goals in place of its own. */
  void install(IronGolem golem, TeamColor team, long seed) {
    var random = new SplittableRandom(seed);
    var goals = hooks.mobGoals();
    goals.removeAllGoals(golem);
    var melee = new Melee(golem, random);
    chases.put(golem.getUniqueId(), melee);
    goals.addGoal(golem, 0, new Swim(golem, random));
    goals.addGoal(golem, 2, melee);
    goals.addGoal(golem, 7, new Stroll(golem, random));
    goals.addGoal(golem, 8, new LookAtPlayer(golem, random));
    goals.addGoal(golem, 8, new LookAround(golem, random));
    goals.addGoal(golem, 2, new Hunt(golem, team, GolemAi.Seeking.PLAYER));
    goals.addGoal(golem, 2, new Hunt(golem, team, GolemAi.Seeking.MOB));
  }

  /** {@code golem}'s blow landed: its next swing waits {@link GolemAi#LANDED_COOLDOWN} ticks. */
  void landed(IronGolem golem) {
    var melee = chases.get(golem.getUniqueId());
    if (melee != null) {
      melee.chase = melee.chase.landed();
    }
  }

  void forget(UUID golem) {
    chases.remove(golem);
  }

  void clear() {
    chases.clear();
  }

  private <T extends Mob> GoalKey<T> key(Class<T> type, String name) {
    return GoalKey.of(type, new NamespacedKey(context.plugin(), "rwf_golem_" + name));
  }

  /** What {@code golem}, fighting for {@code team}, can tell of {@code creature}. */
  GolemAi.Sighting<LivingEntity> sight(IronGolem golem, TeamColor team, LivingEntity creature) {
    var player = creature instanceof Player;
    var untouchable = false;
    var sneaking = false;
    var hidden = false;
    if (creature instanceof Player human) {
      untouchable =
          human.getGameMode() == GameMode.CREATIVE || human.getGameMode() == GameMode.SPECTATOR;
      sneaking = human.isSneaking();
      hidden = summons.hidden(human);
    }
    return new GolemAi.Sighting<>(
        creature,
        Places.vec(Places.at(creature)),
        player,
        summons.alive(creature),
        summons.teamOf(creature).filter(team::equals).isPresent(),
        hidden,
        creature instanceof Creeper,
        untouchable,
        sneaking,
        creature.isInvisible(),
        cover(creature),
        player && hooks.lineOfSight().test(golem, creature));
  }

  /** The share of {@code creature}'s four armour slots that hold something. */
  private static double cover(LivingEntity creature) {
    var equipment = creature.getEquipment();
    if (equipment == null) {
      return 0;
    }
    var worn = 0;
    for (var piece : equipment.getArmorContents()) {
      if (piece != null && !piece.isEmpty()) {
        worn++;
      }
    }
    return worn / 4.0;
  }

  /** Swims up in water or lava (Minecraft 1.12's float goal). */
  private final class Swim implements Goal<IronGolem> {

    private final IronGolem golem;
    private final SplittableRandom random;

    Swim(IronGolem golem, SplittableRandom random) {
      this.golem = golem;
      this.random = random;
    }

    @Override
    public boolean shouldActivate() {
      return golem.isInWater() || golem.isInLava();
    }

    @Override
    public void tick() {
      if (GolemAi.swims(random)) {
        golem.setJumping(true);
      }
    }

    @Override
    public GoalKey<IronGolem> getKey() {
      return key(IronGolem.class, "swim");
    }

    @Override
    public EnumSet<GoalType> getTypes() {
      return EnumSet.of(GoalType.JUMP);
    }
  }

  /** Chases its target and hits it in reach (Minecraft 1.12's melee attack goal). */
  private final class Melee implements Goal<IronGolem> {

    private final IronGolem golem;
    private final SplittableRandom random;
    private GolemAi.Chase chase = GolemAi.Chase.START;
    private Pathfinder.@Nullable PathResult path;

    Melee(IronGolem golem, SplittableRandom random) {
      this.golem = golem;
      this.random = random;
    }

    private Optional<LivingEntity> target() {
      var target = golem.getTarget();
      return target == null || target.isDead() || !target.isValid()
          ? Optional.empty()
          : Optional.of(target);
    }

    private GolemAi.Target where(LivingEntity target) {
      var feet = Places.at(target);
      return new GolemAi.Target(
          Places.vec(feet),
          Places.at(golem).distanceSquared(feet),
          GolemAi.reach(golem.getWidth(), target.getWidth()));
    }

    @Override
    public boolean shouldActivate() {
      var target = target();
      if (target.isEmpty()) {
        return false;
      }
      path = golem.getPathfinder().findPath(target.orElseThrow());
      if (path != null) {
        return true;
      }
      var where = where(target.orElseThrow());
      return where.reach() >= where.distance();
    }

    @Override
    public boolean shouldStayActive() {
      return target().isPresent() && golem.getPathfinder().hasPath();
    }

    @Override
    public void start() {
      var found = path;
      if (found != null) {
        golem.getPathfinder().moveTo(found, GolemAi.SPEED);
      }
      chase = new GolemAi.Chase(0, chase.pathedTo(), chase.cooldown());
    }

    @Override
    public void stop() {
      if (golem.getTarget() instanceof Player player
          && (player.getGameMode() == GameMode.CREATIVE
              || player.getGameMode() == GameMode.SPECTATOR)) {
        golem.setTarget(null);
      }
      golem.getPathfinder().stopPathfinding();
    }

    @Override
    public void tick() {
      var found = target();
      if (found.isEmpty()) {
        return;
      }
      var target = found.orElseThrow();
      golem.lookAt(target, GolemAi.CHASE_TURN, GolemAi.CHASE_TURN);
      var step =
          GolemAi.chase(chase, where(target), hooks.lineOfSight().test(golem, target), random);
      chase = step.next();
      if (step.repath() && !golem.getPathfinder().moveTo(target, GolemAi.SPEED)) {
        chase = chase.unreachable();
      }
      if (step.swing()) {
        golem.swingMainHand();
        golem.attack(target);
      }
    }

    @Override
    public GoalKey<IronGolem> getKey() {
      return key(IronGolem.class, "melee");
    }

    @Override
    public EnumSet<GoalType> getTypes() {
      return EnumSet.of(GoalType.MOVE, GoalType.LOOK);
    }
  }

  /** Wanders off now and then while players are about (Minecraft 1.12's random stroll). */
  private final class Stroll implements Goal<IronGolem> {

    private final IronGolem golem;
    private final SplittableRandom random;
    private @Nullable Location spot;

    Stroll(IronGolem golem, SplittableRandom random) {
      this.golem = golem;
      this.random = random;
    }

    @Override
    public boolean shouldActivate() {
      if (!GolemAi.strolls(golem.getNoActionTicks(), random)) {
        return false;
      }
      // Minecraft 1.12 took the first spot over a whole block, path or no path; a stroll with no
      // way there ends at once.
      var at = Places.at(golem).getBlock();
      for (var offset : GolemAi.strollSpots(random)) {
        var block = at.getRelative(offset[0], offset[1], offset[2]);
        if (Ground.fullSolid(block.getRelative(BlockFace.DOWN))) {
          spot = block.getLocation().add(0.5, 0, 0.5);
          return true;
        }
      }
      return false;
    }

    @Override
    public boolean shouldStayActive() {
      return golem.getPathfinder().hasPath();
    }

    @Override
    public void start() {
      var going = spot;
      if (going != null) {
        golem.getPathfinder().moveTo(going, GolemAi.SPEED);
      }
    }

    @Override
    public GoalKey<IronGolem> getKey() {
      return key(IronGolem.class, "stroll");
    }

    @Override
    public EnumSet<GoalType> getTypes() {
      return EnumSet.of(GoalType.MOVE);
    }
  }

  /** Now and then looks at the nearest player within 8 blocks (Minecraft 1.12). */
  private final class LookAtPlayer implements Goal<IronGolem> {

    private final IronGolem golem;
    private final SplittableRandom random;
    private @Nullable Player watched;
    private int ticks;

    LookAtPlayer(IronGolem golem, SplittableRandom random) {
      this.golem = golem;
      this.random = random;
    }

    @Override
    public boolean shouldActivate() {
      if (!GolemAi.glances(random)) {
        return false;
      }
      Player nearest = null;
      var best = -1.0;
      for (var player : golem.getWorld().getPlayers()) {
        var away = Places.at(player).distanceSquared(Places.at(golem));
        if (player.getGameMode() != GameMode.SPECTATOR
            && away < GolemAi.LOOK_RANGE * GolemAi.LOOK_RANGE
            && (best < 0 || away < best)) {
          nearest = player;
          best = away;
        }
      }
      watched = nearest;
      return nearest != null;
    }

    @Override
    public boolean shouldStayActive() {
      var player = watched;
      return player != null
          && !player.isDead()
          && Places.at(golem).distanceSquared(Places.at(player))
              <= GolemAi.LOOK_RANGE * GolemAi.LOOK_RANGE
          && ticks > 0;
    }

    @Override
    public void start() {
      ticks = GolemAi.lookTicks(random);
    }

    @Override
    public void stop() {
      watched = null;
    }

    @Override
    public void tick() {
      var player = watched;
      if (player != null) {
        var at = Places.at(player);
        golem.lookAt(
            at.getX(),
            at.getY() + player.getEyeHeight(),
            at.getZ(),
            golem.getHeadRotationSpeed(),
            golem.getMaxHeadPitch());
      }
      ticks--;
    }

    @Override
    public GoalKey<IronGolem> getKey() {
      return key(IronGolem.class, "look_at_player");
    }

    @Override
    public EnumSet<GoalType> getTypes() {
      return EnumSet.of(GoalType.LOOK);
    }
  }

  /** Now and then looks around at nothing (Minecraft 1.12). */
  private final class LookAround implements Goal<IronGolem> {

    private final IronGolem golem;
    private final SplittableRandom random;
    private double dx;
    private double dz;
    private int ticks;

    LookAround(IronGolem golem, SplittableRandom random) {
      this.golem = golem;
      this.random = random;
    }

    @Override
    public boolean shouldActivate() {
      return GolemAi.glances(random);
    }

    @Override
    public boolean shouldStayActive() {
      return ticks >= 0;
    }

    @Override
    public void start() {
      var angle = Math.PI * 2 * random.nextDouble();
      dx = Math.cos(angle);
      dz = Math.sin(angle);
      ticks = GolemAi.glanceTicks(random);
    }

    @Override
    public void tick() {
      ticks--;
      var at = Places.at(golem);
      golem.lookAt(
          at.getX() + dx,
          at.getY() + golem.getEyeHeight(),
          at.getZ() + dz,
          golem.getHeadRotationSpeed(),
          golem.getMaxHeadPitch());
    }

    @Override
    public GoalKey<IronGolem> getKey() {
      return key(IronGolem.class, "look_around");
    }

    @Override
    public EnumSet<GoalType> getTypes() {
      return EnumSet.of(GoalType.MOVE, GoalType.LOOK);
    }
  }

  /**
   * Takes the nearest player, or the nearest mob, Red Warfare's selector allows (Minecraft 1.12's
   * nearest attackable target goal), and keeps it while it is near, alive and, for a player, seen.
   */
  private final class Hunt implements Goal<IronGolem> {

    private final IronGolem golem;
    private final TeamColor team;
    private final GolemAi.Seeking seeking;
    private @Nullable LivingEntity found;
    private int unseen;

    Hunt(IronGolem golem, TeamColor team, GolemAi.Seeking seeking) {
      this.golem = golem;
      this.team = team;
      this.seeking = seeking;
    }

    @Override
    public boolean shouldActivate() {
      var feet = Places.vec(Places.at(golem));
      var sightings = new ArrayList<GolemAi.Sighting<LivingEntity>>();
      var choice =
          switch (seeking) {
            case PLAYER -> {
              for (var player : golem.getWorld().getPlayers()) {
                sightings.add(sight(golem, team, player));
              }
              yield GolemAi.nearestPlayer(feet, golem.getEyeHeight(), sightings);
            }
            case MOB -> {
              for (var mob : nearbyMobs()) {
                sightings.add(sight(golem, team, mob));
              }
              yield GolemAi.nearestMob(feet, sightings);
            }
          };
      found = choice.map(GolemAi.Sighting::who).orElse(null);
      return found != null;
    }

    private List<LivingEntity> nearbyMobs() {
      var box =
          golem
              .getBoundingBox()
              .expand(GolemAi.FOLLOW_RANGE, GolemAi.SEARCH_HEIGHT, GolemAi.FOLLOW_RANGE);
      var mobs = new ArrayList<LivingEntity>();
      for (var entity : golem.getWorld().getNearbyEntities(box)) {
        if (entity instanceof Mob mob && !mob.equals(golem) && summons.creature(mob)) {
          mobs.add(mob);
        }
      }
      return mobs;
    }

    @Override
    public boolean shouldStayActive() {
      var target = golem.getTarget();
      if (target == null) {
        return false;
      }
      var sighting = sight(golem, team, target);
      if (!GolemAi.keeps(sighting, Places.vec(Places.at(golem)))) {
        return false;
      }
      if (seeking == GolemAi.Seeking.PLAYER) {
        unseen = GolemAi.unseen(unseen, sighting.seen());
        return unseen <= GolemAi.UNSEEN_TICKS;
      }
      return true;
    }

    @Override
    public void start() {
      unseen = 0;
      golem.setTarget(found);
    }

    @Override
    public void stop() {
      golem.setTarget(null);
      found = null;
    }

    @Override
    public GoalKey<IronGolem> getKey() {
      return key(IronGolem.class, "hunt_" + seeking.name().toLowerCase(Locale.ROOT));
    }

    @Override
    public EnumSet<GoalType> getTypes() {
      return EnumSet.of(GoalType.TARGET);
    }
  }
}
