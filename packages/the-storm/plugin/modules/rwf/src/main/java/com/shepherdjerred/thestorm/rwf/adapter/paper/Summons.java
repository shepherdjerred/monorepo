// Ported from libraryaddict's Red Warfare
// (redwarfare-arcade/src/me/libraryaddict/arcade/game/searchanddestroy/killstreak/streaks/
// WolvesKillstreak.java and IronGolemKillstreak.java, and the summons' damage through
// redwarfare-core/src/me/libraryaddict/core/damage/DamageManager.java and
// redwarfare-arcade/src/me/libraryaddict/arcade/managers/EventManager.java); see
// packages/the-storm/NOTICE.
package com.shepherdjerred.thestorm.rwf.adapter.paper;

import com.shepherdjerred.thestorm.rwf.domain.ability.AbilityInput;
import com.shepherdjerred.thestorm.rwf.domain.ability.KitCombat;
import com.shepherdjerred.thestorm.rwf.domain.ability.KitState;
import com.shepherdjerred.thestorm.rwf.domain.ability.kits.Ghost;
import com.shepherdjerred.thestorm.rwf.domain.ability.kits.Wraith;
import com.shepherdjerred.thestorm.rwf.domain.combat.AttackType;
import com.shepherdjerred.thestorm.rwf.domain.combat.CombatRules;
import com.shepherdjerred.thestorm.rwf.domain.combat.DamageFormula;
import com.shepherdjerred.thestorm.rwf.domain.combat.HitWindow;
import com.shepherdjerred.thestorm.rwf.domain.combat.Knockback;
import com.shepherdjerred.thestorm.rwf.domain.combatant.CombatantId;
import com.shepherdjerred.thestorm.rwf.domain.combatant.TeamColor;
import com.shepherdjerred.thestorm.rwf.domain.geometry.Vec3;
import com.shepherdjerred.thestorm.rwf.domain.killstreak.Delivery;
import com.shepherdjerred.thestorm.rwf.domain.killstreak.GolemAi;
import com.shepherdjerred.thestorm.rwf.domain.match.Combatant;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.random.RandomGenerator;
import net.kyori.adventure.text.Component;
import org.bukkit.DyeColor;
import org.bukkit.EntityEffect;
import org.bukkit.Location;
import org.bukkit.Sound;
import org.bukkit.attribute.Attribute;
import org.bukkit.entity.ArmorStand;
import org.bukkit.entity.Entity;
import org.bukkit.entity.IronGolem;
import org.bukkit.entity.LivingEntity;
import org.bukkit.entity.Mob;
import org.bukkit.entity.Player;
import org.bukkit.entity.Wolf;
import org.jspecify.annotations.Nullable;

/**
 * The creatures killstreaks summon: three attack dogs and an iron golem, each fighting for its
 * owner's team. Dogs are tamed by their owner, hunt the nearest creature they can see that is not
 * of their team (a hidden Ghost or Wraith only once it gives itself away), and come back to heel
 * each second; they go when their owner dies. The golem thinks with Red Warfare's goals ({@link
 * GolemGoals}). A summon's blow goes through the combat rules as a melee hit credited to its owner,
 * and a fighter's blow on an enemy summon goes through them too. Everything goes when the match
 * resets. Main thread only.
 */
final class Summons {

  /**
   * One summoned creature.
   *
   * @param mob the creature
   * @param owner who summoned it
   * @param team the team it fights for
   */
  record Summon(Mob mob, CombatantId owner, TeamColor team) {

    boolean dog() {
      return mob instanceof Wolf;
    }
  }

  /**
   * A damager with no kit of its own: a summon's blow counts as struck directly, as Red Warfare's
   * did, without any kit's damage rules.
   */
  static final KitCombat.Side KITLESS = new KitCombat.Side("", KitState.NONE);

  private final MatchRunner runner;
  private final PaperContext context;
  private final Keys keys;
  private final CombatTracker tracker;
  private final Sacrifices sacrifices;
  private final Map<UUID, Summon> summons = new HashMap<>();
  private @Nullable ServerHooks hooks;
  private @Nullable GolemGoals golems;

  Summons(MatchRunner runner, PaperContext context, Keys keys, CombatTracker tracker) {
    this.runner = runner;
    this.context = context;
    this.keys = keys;
    this.tracker = tracker;
    this.sacrifices = new Sacrifices(runner, context, tracker);
  }

  /** The server operations the summons need; given once, as the module starts. */
  void hooks(ServerHooks given) {
    this.hooks = given;
    this.golems = new GolemGoals(this, context, given);
  }

  ServerHooks hooks() {
    var given = hooks;
    if (given == null) {
      throw new IllegalStateException("the summons were never given the server hooks");
    }
    return given;
  }

  private GolemGoals golems() {
    var given = golems;
    if (given == null) {
      throw new IllegalStateException("the summons were never given the server hooks");
    }
    return given;
  }

  /** The summon {@code entity} is, if it is one. */
  Optional<Summon> of(@Nullable Entity entity) {
    return entity == null
        ? Optional.empty()
        : Optional.ofNullable(summons.get(entity.getUniqueId()));
  }

  /** Every summon alive, for tests. */
  List<Summon> all() {
    return List.copyOf(summons.values());
  }

  /**
   * Match entities include Citizens players, which are not guaranteed to be in a world's player
   * list.
   */
  List<Player> combatants() {
    return runner.match().members().stream()
        .filter(Combatant::alive)
        .map(member -> runner.entity(member.id()))
        .flatMap(Optional::stream)
        .toList();
  }

  /**
   * Three attack dogs at {@code at} for {@code owner}: tamed by them, angry, in their team's
   * collars, with the hearts of a tamed wolf. Red Warfare's wolves had one coat and one voice.
   */
  void dogs(Player owner, CombatantId id, TeamColor team, Location at) {
    var random = runner.match().random(runner.now());
    for (var i = 0; i < Delivery.WOLVES; i++) {
      var x = random.nextDouble() * 2 * Delivery.WOLF_SPREAD - Delivery.WOLF_SPREAD;
      var z = random.nextDouble() * 2 * Delivery.WOLF_SPREAD - Delivery.WOLF_SPREAD;
      var wolf =
          at.getWorld()
              .spawn(
                  at.clone().add(x, 0, z),
                  Wolf.class,
                  dog -> {
                    keys.tagKitEntity(dog);
                    dog.setPersistent(false);
                    dog.setVariant(Wolf.Variant.PALE);
                    dog.setSoundVariant(Wolf.SoundVariant.CLASSIC);
                    dog.setOwner(owner);
                  });
      wolf.setCollarColor(collar(team));
      wolf.playEffect(EntityEffect.TAMING_SUCCEEDED);
      wolf.setAngry(true);
      health(wolf, Delivery.WOLF_HEALTH, Delivery.WOLF_HEALTH);
      wolf.customName(Component.text(owner.getName() + "'s Wolf", Scoreboards.color(team)));
      wolf.setCustomNameVisible(true);
      summons.put(wolf.getUniqueId(), new Summon(wolf, id, team));
    }
  }

  /**
   * An iron golem at {@code at} for {@code owner}, landing with half its health, its own goals
   * swapped for Red Warfare's.
   */
  void golem(Player owner, CombatantId id, TeamColor team, Location at) {
    var golem =
        at.getWorld()
            .spawn(
                at,
                IronGolem.class,
                spawned -> {
                  keys.tagKitEntity(spawned);
                  spawned.setPersistent(false);
                });
    health(golem, Delivery.GOLEM_MAX_HEALTH, Delivery.GOLEM_HEALTH);
    golem.customName(Component.text(owner.getName() + "'s Iron Golem", Scoreboards.color(team)));
    golem.setCustomNameVisible(true);
    summons.put(golem.getUniqueId(), new Summon(golem, id, team));
    golems().install(golem, team, runner.match().random(runner.now()).nextLong());
  }

  private static void health(LivingEntity entity, double max, double health) {
    var attribute = entity.getAttribute(Attribute.MAX_HEALTH);
    if (attribute == null) {
      throw new IllegalStateException(entity.getType() + " has no max health");
    }
    attribute.setBaseValue(max);
    entity.setHealth(health);
  }

  private static DyeColor collar(TeamColor team) {
    return switch (team) {
      case RED -> DyeColor.RED;
      case BLUE -> DyeColor.BLUE;
      case GREEN -> DyeColor.GREEN;
      case PURPLE -> DyeColor.PURPLE;
      case YELLOW -> DyeColor.YELLOW;
    };
  }

  // ---- who is who ---------------------------------------------------------------------------

  /** The team {@code entity} fights for: a member's team, or a summon's. */
  Optional<TeamColor> teamOf(Entity entity) {
    var summon = summons.get(entity.getUniqueId());
    if (summon != null) {
      return Optional.of(summon.team());
    }
    return runner.memberOf(entity.getUniqueId()).flatMap(Combatant::team);
  }

  /**
   * Whether Red Warfare counted {@code entity} alive: a player fighting in the match, or any other
   * creature still in the world.
   */
  boolean alive(Entity entity) {
    if (entity instanceof Player player) {
      return runner.fighting(player.getUniqueId());
    }
    return entity.isValid() && !entity.isDead();
  }

  /**
   * Whether {@code entity} is a creature as Red Warfare knew them: anything living but the things
   * The Storm's own kits put in the world, which the original had none of. Summons count.
   */
  boolean creature(Entity entity) {
    return entity instanceof LivingEntity
        && !(entity instanceof ArmorStand)
        && (summons.containsKey(entity.getUniqueId()) || !keys.isKitEntity(entity));
  }

  /** Whether {@code player} is a Ghost or Wraith giving nothing away. */
  boolean hidden(Player player) {
    var hidingKit =
        runner
            .memberOf(player.getUniqueId())
            .flatMap(Combatant::kit)
            .filter(Set.of(Ghost.ID, Wraith.ID)::contains)
            .isPresent();
    var inventory = player.getInventory();
    var holding =
        !inventory.getItemInMainHand().isEmpty() || !inventory.getItemInOffHand().isEmpty();
    return GolemAi.hidden(hidingKit, player.isSprinting(), holding, player.getArrowsInBody());
  }

  /**
   * Whether {@code summon} may take {@code target}, as Red Warfare's match judged every creature's
   * targeting: anyone it may lose, nobody dead and nobody of its own team.
   */
  boolean mayTarget(Summon summon, @Nullable Entity target) {
    if (target == null) {
      return true;
    }
    return runner.live()
        && creature(target)
        && alive(target)
        && target.getWorld().equals(summon.mob().getWorld())
        && teamOf(target).filter(summon.team()::equals).isEmpty()
        && (!(target instanceof Player player) || !hidden(player));
  }

  /**
   * Whether the dog may go for {@code target}, as Red Warfare's {@code isValidTarget} judged: a
   * creature within {@link Delivery#WOLF_RANGE}, not of its team, alive, in its sight, and not a
   * hidden Ghost or Wraith.
   */
  boolean prey(Summon dog, @Nullable Entity target) {
    if (target == null || !creature(target) || !target.getWorld().equals(dog.mob().getWorld())) {
      return false;
    }
    if (Places.at(target).distance(Places.at(dog.mob())) > Delivery.WOLF_RANGE) {
      return false;
    }
    if (teamOf(target).filter(dog.team()::equals).isPresent() || !alive(target)) {
      return false;
    }
    if (!hooks().lineOfSight().test(dog.mob(), (LivingEntity) target)) {
      return false;
    }
    return !(target instanceof Player player) || !hidden(player);
  }

  // ---- fighting -----------------------------------------------------------------------------

  /**
   * {@code summon}'s blow on {@code victim}: a melee hit of a dog's 6 or the golem's 13 or 14,
   * through the hit window, the victim's armour and kit, credited to the owner. A dog's bite knocks
   * back as any melee hit does; the golem throws its victim straight up. Returns whether it landed.
   */
  boolean strike(Summon summon, LivingEntity victim) {
    if (!mayTarget(summon, victim) || !summon.mob().isValid() || summon.mob().isDead()) {
      return false;
    }
    var random = runner.match().random(runner.now());
    var raw = summon.dog() ? Delivery.WOLF_BITE : Delivery.golemBlow(random);
    if (victim instanceof Player player) {
      return strikePlayer(summon, player, raw, random);
    }
    var landed = window(victim, raw, AttackType.MELEE);
    if (landed <= 0) {
      return false;
    }
    tracker.hit(victim, raw, Optional.of(summon.owner().uuid()), AttackType.MELEE);
    knockback(summon, victim, random);
    flinch(victim, random);
    Harm.take(victim, landed);
    return true;
  }

  private boolean strikePlayer(Summon summon, Player player, double raw, RandomGenerator random) {
    var side = runner.kits().side(player.getUniqueId());
    if (side.isEmpty()) {
      return false;
    }
    var hit = DamageFormula.Hit.of(AttackType.MELEE, raw, KitFactory.armor(player));
    var damage =
        PaperKitResistance.apply(
            player,
            KitCombat.damage(hit, Optional.of(KITLESS), side.orElseThrow(), random),
            AttackType.MELEE);
    var landed = window(player, damage, AttackType.MELEE);
    if (landed <= 0) {
      return false;
    }
    var owner = summon.owner().uuid();
    tracker.hit(player, damage, Optional.of(owner), AttackType.MELEE);
    knockback(summon, player, random);
    hooks().hurt().accept(player);
    player.getWorld().playSound(Places.at(player), Sound.ENTITY_PLAYER_HURT, 1, 1);
    if (sacrifices.shieldFor(owner, player, hit)) {
      return true;
    }
    runner.damaged(player, Optional.of(owner), Harm.toHealth(player, landed), AttackType.MELEE);
    Harm.take(player, landed);
    runner
        .memberOf(player.getUniqueId())
        .ifPresent(
            member ->
                runner
                    .kits()
                    .act(
                        member.id(),
                        new AbilityInput.Hurt(
                            Optional.of(summon.owner()), AttackType.MELEE, landed)));
    return true;
  }

  /**
   * {@code attacker}'s hit through {@code source} on {@code summon}: Red Warfare's melee damage for
   * the weapon held (or the projectile's own) with the attacker's kit, through the hit window,
   * knocking the summon back. Returns whether it landed.
   */
  boolean struck(Player attacker, Entity source, Summon summon, double projectileDamage) {
    if (!runner.fighting(attacker.getUniqueId())
        || !summon.mob().isValid()
        || summon.mob().isDead()
        || teamOf(attacker).filter(summon.team()::equals).isPresent()) return false;
    var melee = source instanceof Player;
    var hit =
        melee
            ? DamageFormula.Hit.melee(
                KitFactory.spec(attacker.getInventory().getItemInMainHand(), Optional.empty()),
                List.of())
            : DamageFormula.Hit.of(AttackType.PROJECTILE, projectileDamage, List.of());
    var random = runner.match().random(runner.now());
    var damage = KitCombat.damage(hit, runner.kits().side(attacker.getUniqueId()), KITLESS, random);
    var victim = summon.mob();
    var landed = window(victim, damage, hit.attack());
    if (landed <= 0) {
      return false;
    }
    tracker.hit(victim, damage, Optional.of(attacker.getUniqueId()), hit.attack());
    victim.setVelocity(Places.vector(CombatListener.push(source, attacker, victim, random)));
    if (melee) {
      CombatListener.sprintReset(attacker);
    }
    flinch(victim, random);
    Harm.take(victim, landed);
    return true;
  }

  /**
   * What of {@code damage}, dealt as {@code type}, gets through {@code victim}'s hit window; a full
   * hit opens a new one.
   */
  double window(LivingEntity victim, double damage, AttackType type) {
    return switch (HitWindow.resolve(damage, type, tracker.guard(victim))) {
      case HitWindow.Resolution.Blocked _ -> 0.0;
      case HitWindow.Resolution.Partial partial -> partial.extra();
      case HitWindow.Resolution.Full full -> {
        victim.setNoDamageTicks(
            victim.getMaximumNoDamageTicks() == 0 ? 0 : CombatRules.MAX_NO_DAMAGE_TICKS);
        yield full.damage();
      }
    };
  }

  private void knockback(Summon summon, LivingEntity victim, RandomGenerator random) {
    Vec3 knockback;
    if (summon.dog()) {
      knockback =
          Knockback.compute(
              Knockback.Params.hit(
                  Places.vec(Places.at(summon.mob())),
                  Places.vec(Places.at(victim)),
                  Places.vec(victim.getVelocity()),
                  0),
              random);
    } else {
      knockback = new Vec3(0, Delivery.GOLEM_THROW, 0);
    }
    var scale =
        runner
            .kits()
            .side(victim.getUniqueId())
            .map(side -> KitCombat.knockback(side.kit()))
            .orElse(1.0);
    victim.setVelocity(Places.vector(knockback.scaled(scale)));
  }

  /** The golem's blow landed: its next waits longer. */
  void landed(IronGolem golem) {
    golems().landed(golem);
  }

  /**
   * {@code creature} was hurt outside the server's own damage: it flinches red and cries out, as
   * Red Warfare's {@code playDamage} made it.
   */
  static void flinch(LivingEntity creature, RandomGenerator random) {
    creature.playHurtAnimation(0);
    var sound = creature.getHurtSound();
    if (sound != null) {
      var first = random.nextFloat();
      var second = random.nextFloat();
      var pitch = (first - second) * 0.2F + 1;
      creature.getWorld().playSound(creature, sound, creature.getSoundVolume(), pitch);
    }
  }

  // ---- the clock ----------------------------------------------------------------------------

  /**
   * Once a second, as Red Warfare's {@code CubUpdate}: the dead are forgotten, each dog drops prey
   * it may no longer have and finds the nearest it may, and a dog too far from its owner is called
   * back to heel.
   */
  void tick() {
    for (var summon : List.copyOf(summons.values())) {
      if (!summon.mob().isValid()) {
        summons.remove(summon.mob().getUniqueId());
        golems().forget(summon.mob().getUniqueId());
        continue;
      }
      if (!summon.dog()) {
        continue;
      }
      var target = summon.mob().getTarget();
      if (target != null && !prey(summon, target)) {
        summon.mob().setTarget(null);
      }
      if (summon.mob().getTarget() == null) {
        nearest(summon).ifPresent(summon.mob()::setTarget);
      }
      heel(summon);
    }
  }

  private Optional<LivingEntity> nearest(Summon dog) {
    LivingEntity closest = null;
    var distance = 0.0;
    var range = Delivery.WOLF_RANGE;
    for (var entity : dog.mob().getNearbyEntities(range, range, range)) {
      if (!prey(dog, entity)) {
        continue;
      }
      var away = Places.at(dog.mob()).distance(Places.at(entity));
      if (closest == null || distance > away) {
        closest = (LivingEntity) entity;
        distance = away;
      }
    }
    return Optional.ofNullable(closest);
  }

  /**
   * A dog strays at most a block and a half from a spot three blocks ahead of its owner, or sixteen
   * while it hunts; further, it runs back and gives up its prey.
   */
  private void heel(Summon summon) {
    var owner = runner.entity(summon.owner());
    if (owner.isEmpty() || !owner.orElseThrow().getWorld().equals(summon.mob().getWorld())) {
      return;
    }
    var player = owner.orElseThrow();
    var at = Places.at(player);
    var ahead = at.clone().add(at.getDirection().multiply(Delivery.WOLF_AHEAD));
    ahead.setY(at.getY());
    var range = summon.mob().getTarget() == null ? Delivery.WOLF_HEEL : Delivery.WOLF_LEASH;
    if (Places.at(summon.mob()).distance(ahead) > range) {
      summon
          .mob()
          .getPathfinder()
          .moveTo(ahead, player.isSprinting() ? Delivery.WOLF_SPRINT_SPEED : Delivery.WOLF_SPEED);
      summon.mob().setTarget(null);
    }
  }

  // ---- going --------------------------------------------------------------------------------

  /** The combatant embodied by {@code owner} died or left: their dogs go with them. */
  void dismiss(UUID owner) {
    for (var summon : List.copyOf(summons.values())) {
      if (summon.dog() && summon.owner().uuid().equals(owner)) {
        summon.mob().remove();
        summons.remove(summon.mob().getUniqueId());
      }
    }
  }

  /** The match reset: every summon goes. */
  void clear() {
    var gone = new ArrayList<>(summons.values());
    summons.clear();
    if (golems != null) {
      golems.clear();
    }
    gone.forEach(summon -> summon.mob().remove());
  }
}
