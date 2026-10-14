package com.shepherdjerred.thestorm.rwf.adapter.paper;

import com.shepherdjerred.thestorm.rwf.domain.ability.AbilityEffect;
import com.shepherdjerred.thestorm.rwf.domain.ability.AbilityInput;
import com.shepherdjerred.thestorm.rwf.domain.ability.KitCombat;
import com.shepherdjerred.thestorm.rwf.domain.ability.KitCue;
import com.shepherdjerred.thestorm.rwf.domain.ability.Motion;
import com.shepherdjerred.thestorm.rwf.domain.ability.kits.Berserker;
import com.shepherdjerred.thestorm.rwf.domain.ability.kits.Engineer;
import com.shepherdjerred.thestorm.rwf.domain.ability.kits.Explosive;
import com.shepherdjerred.thestorm.rwf.domain.ability.kits.Sacrificial;
import com.shepherdjerred.thestorm.rwf.domain.combatant.CombatantId;
import com.shepherdjerred.thestorm.rwf.domain.geometry.BlockPos;
import com.shepherdjerred.thestorm.rwf.domain.geometry.Vec3;
import com.shepherdjerred.thestorm.rwf.domain.kit.SafeTeleport;
import com.shepherdjerred.thestorm.rwf.domain.match.Combatant;
import com.shepherdjerred.thestorm.rwf.domain.record.Occurrence;
import io.papermc.paper.registry.RegistryAccess;
import io.papermc.paper.registry.RegistryKey;
import java.time.Duration;
import java.time.Instant;
import java.util.EnumMap;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import net.kyori.adventure.key.Key;
import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.format.NamedTextColor;
import net.kyori.adventure.text.serializer.legacy.LegacyComponentSerializer;
import org.bukkit.Color;
import org.bukkit.Material;
import org.bukkit.Particle;
import org.bukkit.Sound;
import org.bukkit.Tag;
import org.bukkit.attribute.Attribute;
import org.bukkit.attribute.AttributeModifier;
import org.bukkit.block.BlockFace;
import org.bukkit.block.data.BlockData;
import org.bukkit.entity.Player;
import org.bukkit.inventory.EquipmentSlotGroup;
import org.bukkit.potion.PotionEffect;
import org.bukkit.potion.PotionEffectType;

/**
 * Carries out what kit abilities do and reports how combatants move, for the rules in {@code
 * domain.ability}. It keeps only what the server needs between effects: the experience-bar
 * cooldowns, who may not take fall damage, whose hands are frozen, and the blocks kits placed,
 * which are all put back when the match resets. Main thread only.
 */
final class KitPowers {

  /** Red Warfare's dark red bleeding dust. */
  private static final Particle.DustOptions BLOOD = new Particle.DustOptions(Color.MAROON, 1);

  /** How far Red Warfare's particles were sent: its {@code ViewDist.NORMAL}, in blocks. */
  private static final int VIEW_DISTANCE = 24;

  /** The food level a client is shown so it cannot sprint: Red Warfare's 6. */
  static final int NO_SPRINT_FOOD = 6;

  /** The Berserker's red bloodlust dust. */
  private static final Particle.DustOptions BLOODLUST = new Particle.DustOptions(Color.RED, 1);

  /**
   * A cooldown shown on the experience bar.
   *
   * @param from when it started
   * @param until when it is ready
   */
  private record Bar(Instant from, Instant until) {}

  /** Red Warfare's one-second clock, in ticks. */
  private static final int SECOND_TICKS = 20;

  private final MatchRunner runner;
  private final PaperContext context;
  private final KitFactory kits;
  private final Scoreboards boards;
  private final Keys keys;
  private final KitExplosions explosions;
  private final KitDisplays displays;
  private final KitWorld kitWorld;
  private final KitProjectiles projectiles;
  private final Killstreaks streaks;
  private final CombatTracker tracker;
  private final KitCues cues;
  private final KitSkins skins;
  private final GhostArrows arrows = new GhostArrows();
  private long ticks;
  private final Set<UUID> invisible = new HashSet<>();
  private final Map<UUID, Set<UUID>> hiddenFrom = new HashMap<>();
  private final Map<UUID, AbilityEffect.Disguised> disguised = new HashMap<>();
  private final Map<UUID, Bar> bars = new HashMap<>();
  private final Map<UUID, Instant> noFall = new HashMap<>();
  private final Set<UUID> frozen = new HashSet<>();
  private final Map<BlockPos, BlockData> placed = new HashMap<>();
  private final Map<UUID, Vec3> lastPositions = new HashMap<>();

  /**
   * What the powers work with.
   *
   * @param kits kit items
   * @param boards the per-viewer scoreboards
   * @param keys entity tags
   * @param tracker hit bookkeeping, for kit explosions
   * @param streakGate the per-player killstreaks flag
   */
  record Parts(
      KitFactory kits,
      Scoreboards boards,
      Keys keys,
      CombatTracker tracker,
      com.shepherdjerred.thestorm.rwf.app.JoinGate streakGate) {}

  KitPowers(MatchRunner runner, PaperContext context, Parts parts) {
    this.runner = runner;
    this.context = context;
    this.kits = parts.kits();
    this.boards = parts.boards();
    this.keys = parts.keys();
    this.tracker = parts.tracker();
    this.explosions = new KitExplosions(runner, context, parts.tracker());
    this.displays = new KitDisplays(runner, context);
    this.kitWorld = new KitWorld(runner, context, parts.tracker());
    this.projectiles = new KitProjectiles(runner, context, parts.keys(), explosions);
    this.cues = new KitCues(runner, context);
    this.skins = new KitSkins(runner, context, parts.kits());
    this.streaks =
        new Killstreaks(
            runner,
            context,
            new Killstreaks.Parts(parts.keys(), parts.streakGate(), parts.tracker(), explosions));
  }

  KitProjectiles projectiles() {
    return projectiles;
  }

  /** The killstreak rewards. */
  Killstreaks streaks() {
    return streaks;
  }

  boolean isKitEntity(org.bukkit.entity.Entity entity) {
    return keys.isKitEntity(entity);
  }

  /** How {@code id} looks to the enemy now, if disguised. */
  java.util.Optional<AbilityEffect.Disguised> disguise(UUID id) {
    return java.util.Optional.ofNullable(disguised.get(id));
  }

  // ---- motion ------------------------------------------------------------------------------

  /** How {@code player} moved since the last tick. */
  Motion motion(Player player) {
    var at = Places.at(player);
    var position = Places.vec(at);
    var last = lastPositions.put(player.getUniqueId(), position);
    var velocity = last == null ? Vec3.ZERO : position.minus(last);
    return new Motion(
        position,
        velocity,
        at.getYaw(),
        at.getPitch(),
        player.isSneaking(),
        player.isSprinting(),
        ((org.bukkit.entity.Entity) player).isOnGround(),
        player.getHealth(),
        PlayerAttributes.maxHealth(player),
        blocked(player),
        drawingBow(player),
        safe(player));
  }

  /** Whether a solid block stands right in front of {@code player}, at their feet or head. */
  private static boolean blocked(Player player) {
    var at = Places.at(player);
    var direction = at.getDirection().setY(0);
    if (direction.lengthSquared() < 1.0e-6) {
      return false;
    }
    var ahead = at.clone().add(direction.normalize().multiply(0.6));
    return solid(ahead) || solid(ahead.clone().add(0, 1, 0));
  }

  /** Whether a solid block stands at {@code at}; nothing does outside the world's height. */
  private static boolean solid(org.bukkit.Location at) {
    return built(at) && at.getBlock().getType().isSolid();
  }

  /** Whether {@code at} and the block below it are inside the world's buildable height. */
  private static boolean built(org.bukkit.Location at) {
    var world = at.getWorld();
    var y = at.getBlockY();
    return world != null && y > world.getMinHeight() && y < world.getMaxHeight();
  }

  private static boolean drawingBow(Player player) {
    var active = player.getActiveItem();
    return player.isHandRaised()
        && (active.getType() == Material.BOW || active.getType() == Material.CROSSBOW);
  }

  /** Red Warfare's {@code UtilLoc.isSafeTeleport} where {@code player} stands. */
  private static boolean safe(Player player) {
    var world = player.getWorld();
    return SafeTeleport.safe(
        Places.pos(Places.at(player)),
        world.getMinHeight(),
        block ->
            block.y() < world.getMinHeight() || block.y() >= world.getMaxHeight()
                ? SafeTeleport.Footing.CLEAR
                : Footings.of(world.getBlockAt(block.x(), block.y(), block.z()).getType()));
  }

  // ---- effects ----------------------------------------------------------------------------

  /** Carries out {@code effect}. */
  void apply(AbilityEffect effect) {
    switch (effect) {
      case AbilityEffect.Potion potion -> withPlayer(potion.id(), p -> potion(p, potion));
      case AbilityEffect.PotionStack potion -> withPlayer(potion.id(), p -> potionStack(p, potion));
      case AbilityEffect.Send send -> withPlayer(send.id(), p -> send(p, send));
      case AbilityEffect.SwirlingPotion potion ->
          withPlayer(
              potion.id(),
              p ->
                  p.addPotionEffect(
                      new PotionEffect(
                          effectType(potion.effect()), potion.ticks(), potion.amplifier())));
      case AbilityEffect.ClearPotion clear ->
          withPlayer(clear.id(), p -> p.removePotionEffect(effectType(clear.effect())));
      case AbilityEffect.MaxHealth max -> withPlayer(max.id(), p -> maxHealth(p, max));
      case AbilityEffect.Heal heal ->
          withPlayer(
              heal.id(),
              p ->
                  p.setHealth(
                      Math.min(PlayerAttributes.maxHealth(p), p.getHealth() + heal.amount())));
      case AbilityEffect.Cooldown cooldown ->
          bars.put(
              cooldown.id().uuid(), new Bar(runner.now(), runner.now().plus(cooldown.length())));
      case AbilityEffect.Meter meter ->
          withPlayer(
              meter.id(),
              p -> {
                p.setLevel(meter.level());
                if (meter.progress() >= 0) {
                  p.setExp(Math.clamp(meter.progress(), 0, 1));
                }
              });
      case AbilityEffect.Hands hands -> {
        if (hands.frozen()) {
          frozen.add(hands.id().uuid());
        } else {
          frozen.remove(hands.id().uuid());
        }
      }
      case AbilityEffect.Teleport teleport -> withPlayer(teleport.id(), p -> teleport(p, teleport));
      case AbilityEffect.Hop hop -> withPlayer(hop.id(), p -> hop(p, hop));
      case AbilityEffect.TimeTravel travel -> withPlayer(travel.id(), p -> timeTravel(p, travel));
      case AbilityEffect.Used used ->
          runner.hooks().abilityUsed(used.id(), used.ability(), used.target());
      case AbilityEffect.Push push ->
          withPlayer(
              push.id(), p -> p.setVelocity(p.getVelocity().add(Places.vector(push.velocity()))));
      case AbilityEffect.NoFall fall ->
          noFall.put(fall.id().uuid(), runner.now().plus(fall.length()));
      case AbilityEffect.Say say -> say.to().forEach(id -> withPlayer(id, p -> say(p, say)));
      // Cues are dressing: one that cannot be played must not stop the ability's other effects.
      case AbilityEffect.Cue cue ->
          withPlayer(cue.at(), p -> context.guarded("play a kit cue", () -> cue(p, cue.cue())));
      case AbilityEffect.CueAt cue ->
          context.guarded(
              "play a kit cue", () -> cue(Places.center(context.mapWorld(), cue.at()), cue.cue()));
      case AbilityEffect.Hear hear ->
          withPlayer(
              hear.to(),
              to ->
                  withPlayer(
                      hear.at(),
                      at ->
                          context.guarded(
                              "play a kit sound", () -> cues.hear(to, Places.at(at), hear.cue()))));
      case AbilityEffect.SnapSkin snap -> skins.snap(snap.victim());
      case AbilityEffect.Skin skin -> withPlayer(skin.id(), p -> skins.wear(p, skin.of()));
      case AbilityEffect.PlaceBlock block -> place(block.at(), block.material());
      case AbilityEffect.ClearBlock block -> clear(block.at());
      case AbilityEffect.Explode blast -> explode(blast);
      case AbilityEffect.Launch launch ->
          withPlayer(launch.id(), p -> projectiles.launch(p, launch.id(), launch.projectile()));
      case AbilityEffect.Visibility visibility ->
          withPlayer(visibility.id(), p -> visibility(p, visibility.seen()));
      case AbilityEffect.Disguise disguise -> withPlayer(disguise.id(), p -> disguise(p, disguise));
      case AbilityEffect.Unstick unstick ->
          withPlayer(unstick.id(), p -> arrows.unstick(p, unstick.hit(), runner.now()));
      case AbilityEffect.Give give ->
          withPlayer(
              give.id(),
              p -> {
                var material = Material.matchMaterial(give.item().material());
                if (material != null && count(p, material) < give.cap()) {
                  p.getInventory().addItem(kits.kitItem(give.item(), team(give.id())));
                }
              });
      case AbilityEffect.SetSlot set ->
          withPlayer(
              set.id(),
              p -> p.getInventory().setItem(set.slot(), kits.kitItem(set.item(), team(set.id()))));
      case AbilityEffect.Take take ->
          withPlayer(
              take.id(),
              p -> {
                var material = Material.matchMaterial(take.material());
                if (material != null) {
                  take(p, material, take.amount());
                }
              });
      case AbilityEffect.Gear gear -> kitWorld.gear(gear);
      case AbilityEffect.Damage damage -> kitWorld.damage(damage);
      case AbilityEffect.Glow glow -> kitWorld.glow(glow);
      case AbilityEffect.Mark mark -> kitWorld.mark(mark);
      case AbilityEffect.Decoy decoy -> kitWorld.decoy(decoy);
      default -> throw new IllegalStateException("no adapter yet for kit effect " + effect);
    }
  }

  /**
   * A Time Machine use in the original's order: the dark aqua message; out of any passenger; the
   * enderman sound and ender signal where the player leaves; the teleport, which also leaves any
   * vehicle and nudges the landing off an entity standing exactly there (the original's {@code
   * UtilPlayer.tele}); the sound and signal where they land, facing the way they faced there; then
   * fall distance, fire and velocity cleared and nobody credited for a later fall.
   */
  private void timeTravel(Player player, AbilityEffect.TimeTravel travel) {
    player.sendMessage(
        Component.text("You step sideways into the river of time..", NamedTextColor.DARK_AQUA));
    var world = player.getWorld();
    var from = Places.at(player);
    var target = Places.location(world, travel.to().position());
    target.setYaw(travel.to().yaw());
    target.setPitch(travel.to().pitch());
    var _ = player.eject();
    world.playSound(from, Sound.ENTITY_ENDERMAN_TELEPORT, 1, 1);
    world.playEffect(from, org.bukkit.Effect.ENDER_SIGNAL, 9);
    var _ = player.eject();
    var _ = player.leaveVehicle();
    clearOfEntities(target, player.getNearbyEntities(1, 1, 1));
    player.teleport(target);
    world.playSound(target, Sound.ENTITY_ENDERMAN_TELEPORT, 1, 1);
    world.playEffect(target, org.bukkit.Effect.ENDER_SIGNAL, 9);
    player.setFallDistance(0);
    player.setFireTicks(0);
    player.setVelocity(new org.bukkit.util.Vector());
    tracker.clearFallCredit(player.getUniqueId());
  }

  /**
   * The original's landing nudge: while an entity near the player stands within 0.1 of {@code
   * target}, move it by up to 0.01 sideways and up to 0.01 up.
   */
  private void clearOfEntities(
      org.bukkit.Location target, java.util.List<org.bukkit.entity.Entity> nearby) {
    var random = runner.random();
    while (nearby.stream().anyMatch(entity -> entity.getLocation().distance(target) <= 0.1)) {
      target.add(
          random.nextDouble(-0.01, 0.01),
          random.nextDouble(0, 0.01),
          random.nextDouble(-0.01, 0.01));
    }
  }

  private void withPlayer(CombatantId id, java.util.function.Consumer<Player> action) {
    runner.entity(id).ifPresent(action);
  }

  /** Ghosts are invisible to all; a hidden combatant is gone from the enemy's sight entirely. */
  private void visibility(Player player, AbilityEffect.Seen seen) {
    var id = player.getUniqueId();
    switch (seen) {
      case GHOST -> {
        invisible.add(id);
        player.setInvisible(true);
      }
      case HIDDEN -> {
        var from = new HashSet<UUID>();
        var team = runner.memberOf(id).flatMap(Combatant::team);
        for (var member : runner.match().members()) {
          if (member.team().equals(team)) {
            continue;
          }
          runner
              .entity(member.id())
              .ifPresent(
                  enemy -> {
                    enemy.hideEntity(context.plugin(), player);
                    from.add(enemy.getUniqueId());
                  });
        }
        hiddenFrom.put(id, from);
      }
      case VISIBLE -> {
        invisible.remove(id);
        player.setInvisible(false);
        reveal(player);
      }
    }
    boards.looks(player, invisible.contains(id), disguise(id));
  }

  private void reveal(Player player) {
    var from = hiddenFrom.remove(player.getUniqueId());
    if (from == null) {
      return;
    }
    for (var viewer : from) {
      var enemy = context.server().getPlayer(viewer);
      if (enemy != null) {
        enemy.showEntity(context.plugin(), player);
      } else {
        runner
            .memberOf(viewer)
            .flatMap(m -> runner.entity(m.id()))
            .ifPresent(bot -> bot.showEntity(context.plugin(), player));
      }
    }
  }

  private void disguise(Player player, AbilityEffect.Disguise disguise) {
    var id = player.getUniqueId();
    if (disguise.disguise().isPresent()) {
      disguised.put(id, disguise.disguise().orElseThrow());
    } else {
      disguised.remove(id);
    }
    boards.looks(player, invisible.contains(id), disguise(id));
    context.guarded("draw a worn name", () -> displays.wear(player, disguise.disguise()));
  }

  private java.util.Optional<com.shepherdjerred.thestorm.rwf.domain.combatant.TeamColor> team(
      CombatantId id) {
    return runner.member(id).flatMap(Combatant::team);
  }

  /** Takes up to {@code amount} of {@code material}, kit-tagged or not, from {@code player}. */
  private static void take(Player player, Material material, int amount) {
    var left = amount;
    var inventory = player.getInventory();
    for (var slot = 0; slot < inventory.getSize() && left > 0; slot++) {
      var stack = inventory.getItem(slot);
      if (stack == null || stack.getType() != material) {
        continue;
      }
      var taken = Math.min(left, stack.getAmount());
      left -= taken;
      if (taken == stack.getAmount()) {
        inventory.setItem(slot, null);
      } else {
        stack.setAmount(stack.getAmount() - taken);
      }
    }
  }

  private static int count(Player player, Material material) {
    var total = 0;
    for (var stack : player.getInventory()) {
      if (stack != null && stack.getType() == material) {
        total += stack.getAmount();
      }
    }
    return total;
  }

  /** A potion in place of any of its kind, its particles showing, as Red Warfare gave them. */
  private static void potion(Player player, AbilityEffect.Potion potion) {
    var ticks =
        potion.ticks() == AbilityEffect.FOREVER ? PotionEffect.INFINITE_DURATION : potion.ticks();
    player.addPotionEffect(
        new PotionEffect(effectType(potion.effect()), ticks, potion.amplifier()));
  }

  /**
   * A potion on top of any of its kind, as Red Warfare's {@code ConditionManager.addPotion} with
   * {@code extend}: the lengths add and the stronger level stays.
   */
  private static void potionStack(Player player, AbilityEffect.PotionStack potion) {
    var type = effectType(potion.effect());
    var ticks = potion.ticks();
    var amplifier = potion.amplifier();
    var old = player.getPotionEffect(type);
    if (old != null && !old.isInfinite()) {
      ticks += old.getDuration();
      amplifier = Math.max(amplifier, old.getAmplifier());
    }
    player.addPotionEffect(new PotionEffect(type, ticks, amplifier));
  }

  /** A kit blast: the fighters, then every living thing near it off the owner's team. */
  private void explode(AbilityEffect.Explode blast) {
    explosions.explode(blast);
    var team = runner.member(blast.owner()).flatMap(Combatant::team);
    var summons = streaks.summons();
    explosions.explodeOnCreatures(
        blast,
        creature ->
            !(creature instanceof org.bukkit.entity.ArmorStand)
                && summons.creature(creature)
                && summons.alive(creature)
                && summons
                    .teamOf(creature)
                    .filter(t -> team.filter(t::equals).isPresent())
                    .isEmpty());
  }

  /**
   * The Teleporter's {@code UtilPlayer.tele}, facing the way the player already faced; their fall
   * distance and motion carry on, as Red Warfare left them.
   */
  private void teleport(Player player, AbilityEffect.Teleport teleport) {
    var to = Places.location(context.mapWorld(), teleport.to());
    to.setYaw(Places.at(player).getYaw());
    to.setPitch(Places.at(player).getPitch());
    tele(player, to);
    teleport.by().flatMap(runner::entity).ifPresent(by -> tracker.creditFall(player, by));
  }

  /** Red Warfare's Juggernaut start: lifted, then moving up. */
  private static void hop(Player player, AbilityEffect.Hop hop) {
    player.teleport(Places.at(player).add(0, hop.up(), 0));
    player.setVelocity(new org.bukkit.util.Vector(0, hop.up(), 0));
  }

  /**
   * Red Warfare's {@code UtilPlayer.tele}: out of any vehicle and onto the spot, nudged by a hair
   * while anyone already stands right on it, facing the way it was faced.
   */
  private void send(Player player, AbilityEffect.Send send) {
    var to = Places.location(context.mapWorld(), send.to());
    to.setYaw(send.yaw());
    to.setPitch(send.pitch());
    tele(player, to);
    send.by().flatMap(runner::entity).ifPresent(by -> tracker.creditFall(player, by));
  }

  /**
   * Red Warfare's {@code UtilPlayer.tele}: out of any passenger and vehicle, then onto {@code to},
   * nudged by up to a hundredth of a block while anyone near stands within a tenth of it.
   */
  private static void tele(Player player, org.bukkit.Location to) {
    player.eject();
    player.leaveVehicle();
    var near = player.getNearbyEntities(1, 1, 1);
    var random = java.util.concurrent.ThreadLocalRandom.current();
    var nudged = true;
    while (nudged) {
      nudged = false;
      for (var entity : near) {
        if (entity.getLocation().distance(to) <= 0.1) {
          to.add(
              random.nextDouble() * 0.02 - 0.01,
              random.nextDouble() * 0.01,
              random.nextDouble() * 0.02 - 0.01);
          nudged = true;
          break;
        }
      }
    }
    player.teleport(to);
  }

  static PotionEffectType effectType(String key) {
    var type =
        RegistryAccess.registryAccess().getRegistry(RegistryKey.MOB_EFFECT).get(Key.key(key));
    if (type == null) {
      throw new IllegalStateException("kits name only real effects: " + key);
    }
    return type;
  }

  /** Sets {@code player}'s max health through a kit modifier that {@link #clear} removes. */
  private static void maxHealth(Player player, AbilityEffect.MaxHealth max) {
    var attribute = player.getAttribute(Attribute.MAX_HEALTH);
    if (attribute == null) {
      throw new IllegalStateException("players always have max health");
    }
    attribute.removeModifier(Keys.KIT_HEALTH);
    var change = max.max() - attribute.getBaseValue();
    if (change != 0) {
      attribute.addModifier(
          new AttributeModifier(
              Keys.KIT_HEALTH,
              change,
              AttributeModifier.Operation.ADD_NUMBER,
              EquipmentSlotGroup.ANY));
    }
    var value = attribute.getValue();
    player.setHealth(max.fill() ? value : Math.min(value, player.getHealth()));
  }

  private static void say(Player player, AbilityEffect.Say say) {
    var color =
        switch (say.tone()) {
          case INFO -> NamedTextColor.BLUE;
          case REFUSED -> NamedTextColor.RED;
          case GOOD -> NamedTextColor.GREEN;
          case LEGACY -> null;
        };
    // Red Warfare's colour codes in the text colour what follows them.
    var text = LegacyComponentSerializer.legacySection().deserialize(say.text());
    player.sendMessage(color == null ? text : Component.text().color(color).append(text).build());
  }

  /**
   * One particle as Red Warfare's {@code UtilParticle} sent it: to every player in the map world
   * within 24 blocks, drawn however far the viewer's particle setting reaches.
   */
  private static void particle(
      Particle particle, org.bukkit.Location at, @org.jspecify.annotations.Nullable Object data) {
    particle
        .builder()
        .location(at)
        .count(1)
        .offset(0, 0, 0)
        .extra(0)
        .data(data)
        .receivers(VIEW_DISTANCE, true)
        .force(true)
        .spawn();
  }

  private void cue(Player player, KitCue cue) {
    if (KitCues.handles(cue)) {
      cues.play(player, cue);
      return;
    }
    switch (cue) {
      case HEALED -> {
        particle(Particle.HEART, player.getEyeLocation().add(0, 0.4, 0), null);
        player.playSound(Places.at(player), Sound.ENTITY_PLAYER_LEVELUP, 0.1F, 1);
      }
      case HEALS_SPENT ->
          particle(Particle.DAMAGE_INDICATOR, player.getEyeLocation().add(0, 0.4, 0), null);
      case THAWED -> player.playSound(player.getEyeLocation(), Sound.BLOCK_LAVA_POP, 1, 0);
      case BLED -> {
        var random = java.util.concurrent.ThreadLocalRandom.current();
        for (var i = 0; i < 8; i++) {
          var at =
              Places.at(player)
                  .add(
                      random.nextDouble() * 0.3,
                      1 + random.nextDouble() * 0.5,
                      random.nextDouble() * 0.3);
          particle(Particle.DUST, at, BLOOD);
        }
      }
      default -> cue(Places.at(player), cue);
    }
  }

  private void cue(org.bukkit.Location at, KitCue cue) {
    if (KitCues.handles(cue)) {
      cues.play(at, cue);
      return;
    }
    var world = context.mapWorld();
    switch (cue) {
      case FROZEN -> {
        stepSound(at, Material.ICE);
        stepSound(at.clone().add(0, 1, 0), Material.ICE);
      }
      case WARPED -> {
        world.playSound(at, Sound.ENTITY_ENDERMAN_TELEPORT, 1, 1);
        world.playEffect(at, org.bukkit.Effect.ENDER_SIGNAL, 9);
      }
      case MINE_ARMED -> {
        world.spawnParticle(Particle.CRIT, at.clone().add(0, 0.4, 0), 3);
        world.playSound(at, Sound.BLOCK_WOODEN_PRESSURE_PLATE_CLICK_ON, 1, 0.1F);
      }
      case MINE_TRIGGERED -> {
        world.spawnParticle(Particle.LARGE_SMOKE, at.clone().add(0, -0.5, 0), 3, 0.3, 0, 0.3, 0);
        world.playSound(at, Sound.ENTITY_CREEPER_HURT, 1, 0);
        world.playSound(at, Sound.BLOCK_FIRE_EXTINGUISH, 1, 0);
      }
      case SKINNING -> {
        burst(at, Material.REDSTONE_BLOCK);
        burst(at.clone().add(0, 1, 0), Material.REDSTONE_BLOCK);
      }
      case BLOCK_CHANGED -> burst(at, at.getBlock().getType());
      case GHOST_HIT, HEALED, HEALS_SPENT, BLED -> {}
      default -> {
        var tune = Objects.requireNonNull(TUNES.get(cue), () -> "no sound for kit cue " + cue);
        world.playSound(at, tune.sound(), 1, tune.pitch());
      }
    }
  }

  /**
   * The {@code STEP_SOUND} effect Red Warfare played, a block breaking at {@code at}'s block: its
   * crumbs on a 4×4×4 grid flying out from the centre, and its break sound at half again its volume
   * and four fifths its pitch, as the client plays that level event. Paper has marked the effect
   * for removal, so it is drawn here.
   */
  private void stepSound(org.bukkit.Location at, Material block) {
    var world = context.mapWorld();
    var data = block.createBlockData();
    var corner = at.getBlock().getLocation();
    for (var x = 0; x < 4; x++) {
      for (var y = 0; y < 4; y++) {
        for (var z = 0; z < 4; z++) {
          var dx = (x + 0.5) / 4;
          var dy = (y + 0.5) / 4;
          var dz = (z + 0.5) / 4;
          world.spawnParticle(
              Particle.BLOCK,
              corner.clone().add(dx, dy, dz),
              0,
              dx - 0.5,
              dy - 0.5,
              dz - 0.5,
              1,
              data);
        }
      }
    }
    var sound = data.getSoundGroup();
    world.playSound(
        corner.clone().add(0.5, 0.5, 0.5),
        sound.getBreakSound(),
        (sound.getVolume() + 1) / 2,
        sound.getPitch() * 0.8F);
  }

  /** A cue that is only a sound, at full volume. */
  private record Tune(Sound sound, float pitch) {}

  private static final Map<KitCue, Tune> TUNES =
      new EnumMap<>(
          Map.ofEntries(
              Map.entry(KitCue.RESTOCKED, new Tune(Sound.ENTITY_ITEM_PICKUP, 1)),
              Map.entry(KitCue.LEVEL_UP, new Tune(Sound.ENTITY_EXPERIENCE_ORB_PICKUP, 0)),
              Map.entry(KitCue.LEVEL_DOWN, new Tune(Sound.ENTITY_PLAYER_BURP, 0)),
              Map.entry(KitCue.SNIPPED, new Tune(Sound.ENTITY_SHEEP_SHEAR, 0)),
              Map.entry(KitCue.BOND_BROKEN, new Tune(Sound.ENTITY_GHAST_SCREAM, 0)),
              Map.entry(KitCue.THAWED, new Tune(Sound.BLOCK_LAVA_POP, 0)),
              Map.entry(KitCue.PULLED, new Tune(Sound.ENTITY_FISHING_BOBBER_RETRIEVE, 0.6F)),
              Map.entry(KitCue.SPOTTED, new Tune(Sound.BLOCK_BELL_USE, 1.4F)),
              Map.entry(KitCue.SLAMMED, new Tune(Sound.ENTITY_PLAYER_ATTACK_KNOCKBACK, 0.5F)),
              Map.entry(KitCue.READY, new Tune(Sound.BLOCK_NOTE_BLOCK_PLING, 2))));

  /** Red Warfare's {@code Effect.DESTROY_BLOCK}: the block's break crumbs and its break sound. */
  private void burst(org.bukkit.Location at, Material material) {
    if (!material.isBlock() || material.isAir()) {
      return;
    }
    context.mapWorld().playEffect(at, org.bukkit.Effect.DESTROY_BLOCK, material.createBlockData());
  }

  /** Places a block the match owns, remembering what stood there. */
  private void place(BlockPos at, String material) {
    var type = Material.matchMaterial(material);
    if (type == null || !type.isBlock()) {
      throw new IllegalStateException("kits place only real blocks: " + material);
    }
    var block = Places.block(context.mapWorld(), at);
    placed.putIfAbsent(at, block.getBlockData().clone());
    var data = type.createBlockData();
    context.blocks().set("#storm-rwf-kit", block, data, false);
    recorded(type).ifPresent(reason -> runner.hooks().blockPlaced(at, data.getAsString(), reason));
  }

  /** The recording's reason for a kit block of {@code type}: barricades and banners are kept. */
  private static Optional<Occurrence.BlockChange.Reason> recorded(Material type) {
    if (Tag.BANNERS.isTagged(type)) {
      return Optional.of(Occurrence.BlockChange.Reason.BANNER);
    }
    return type == Material.matchMaterial(Engineer.BLOCK)
        ? Optional.of(Occurrence.BlockChange.Reason.BARRICADE)
        : Optional.empty();
  }

  /** Puts back what stood at {@code at} before a kit placed a block there. */
  private void clear(BlockPos at) {
    var original = placed.remove(at);
    if (original != null) {
      var block = Places.block(context.mapWorld(), at);
      var reason = recorded(block.getType());
      context.blocks().set("#storm-rwf-kit", block, original, false);
      reason.ifPresent(why -> runner.hooks().blockPlaced(at, original.getAsString(), why));
    }
  }

  // ---- the clock ----------------------------------------------------------------------------

  /** One tick of a live match: cooldown bars, kit particles, teleporters and their signs. */
  void tick(Instant now) {
    ticks++;
    for (var member : runner.match().members()) {
      if (!member.alive()) {
        continue;
      }
      runner.entity(member.id()).ifPresent(player -> tick(member, player, now));
    }
    noFall.values().removeIf(until -> !now.isBefore(until));
    projectiles.tick(now);
    // The signs are dressing: one that cannot be drawn must not stop the match's clock.
    context.guarded("draw the kit signs", () -> displays.tick(now));
    context.guarded("move the kit world", () -> kitWorld.tick(now));
    context.guarded("show worn armour", skins::tick);
    streaks.tick();
  }

  /**
   * Red Warfare's one-second clock for the kits that hand out more: how many grenades or steaks the
   * fighter holds goes to the rules.
   */
  private void stock(Combatant member, Player player) {
    var kit = member.kit().orElse("");
    var material =
        switch (kit) {
          case Explosive.ID -> Explosive.GRENADE_MATERIAL;
          case Sacrificial.ID -> Sacrificial.STEAK_MATERIAL;
          default -> null;
        };
    if (material == null) {
      return;
    }
    var type = Material.matchMaterial(material);
    if (type != null) {
      runner.kits().act(player, new AbilityInput.Stock(material, count(player, type)));
    }
  }

  private void tick(Combatant member, Player player, Instant now) {
    tracker.tick(player, Battlefield.grounded(player));
    if (member.kit().filter(kit -> !KitCombat.maySprint(kit)).isPresent()) {
      // Red Warfare rewrote every health packet a Juggernaut was sent to show 6 food, which a
      // client cannot sprint on; Paper has no packet rewriting, so the same update follows every
      // tick.
      player.sendHealthUpdate(player.getHealth(), NO_SPRINT_FOOD, player.getSaturation());
    }
    if (player.isSneaking()) {
      travel(player);
    }
    boards.health(player, player.getHealth(), PlayerAttributes.maxHealth(player));
    displays.wornHealth(player, player.getHealth(), PlayerAttributes.maxHealth(player));
    if (member
            .kit()
            .filter(com.shepherdjerred.thestorm.rwf.domain.ability.kits.Wraith.ID::equals)
            .isPresent()
        && drawingBow(player)) {
      context.guarded("show a drawing wraith", () -> cues.drawing(player));
    }
    if (ticks % SECOND_TICKS == 0) {
      stock(member, player);
    }
    var bar = bars.get(player.getUniqueId());
    if (bar != null) {
      var total = Duration.between(bar.from(), bar.until()).toMillis();
      var done = Duration.between(bar.from(), now).toMillis();
      if (total <= 0 || done >= total) {
        bars.remove(player.getUniqueId());
        player.setExp(1);
      } else {
        player.setExp(Math.clamp((float) done / total, 0, 1));
      }
    }
    if (runner.match().abilities().state(member.id()) instanceof Berserker.State berserker
        && berserker.kills() > 0) {
      Particle.DUST
          .builder()
          .location(Places.at(player).add(0, 1, 0))
          .count(berserker.kills() * 2)
          .offset(0.4, 1, 0.4)
          .extra(0)
          .data(BLOODLUST)
          .receivers(VIEW_DISTANCE, true)
          .force(true)
          .spawn();
    }
  }

  /** A combatant sneaking on a teleporter travels through it, if the rules let them. */
  private void travel(Player player) {
    var under = Places.at(player).getBlock().getRelative(BlockFace.DOWN);
    var abilities = runner.match().abilities();
    var placed = abilities.placedAt(Places.pos(under));
    if (!(placed.orElse(null)
        instanceof com.shepherdjerred.thestorm.rwf.domain.ability.Placed.Teleporter teleporter)) {
      return;
    }
    if (!abilities.ready(
        runner.memberOf(player.getUniqueId()).orElseThrow().id(),
        com.shepherdjerred.thestorm.rwf.domain.ability.kits.Teleporter.TRAVEL,
        runner.now())) {
      return;
    }
    var other =
        abilities.placed().stream()
            .filter(
                p ->
                    p instanceof com.shepherdjerred.thestorm.rwf.domain.ability.Placed.Teleporter t
                        && t.owner().equals(teleporter.owner())
                        && !t.equals(teleporter))
            .findFirst();
    var clear =
        other
            .map(
                p -> KitListener.roomAbove(Places.block(context.mapWorld(), p.blocks().getFirst())))
            .orElse(false);
    runner
        .kits()
        .act(
            player,
            new com.shepherdjerred.thestorm.rwf.domain.ability.AbilityInput.UseTeleporter(
                teleporter.block(), clear));
  }

  // ---- what other listeners ask -------------------------------------------------------------

  /** Whether {@code player}'s hands are frozen. */
  boolean frozen(UUID player) {
    return frozen.contains(player);
  }

  /** Whether {@code player} lands without fall damage now. */
  boolean noFall(UUID player) {
    return noFallUntil(player).isPresent();
  }

  Optional<Instant> noFallUntil(UUID player) {
    return Optional.ofNullable(noFall.get(player)).filter(until -> runner.now().isBefore(until));
  }

  /** Takes every kit change off {@code player}: their health modifier, bar and frozen hands. */
  void clear(Player player) {
    streaks.dismiss(player.getUniqueId());
    var attribute = player.getAttribute(Attribute.MAX_HEALTH);
    if (attribute != null) {
      attribute.removeModifier(Keys.KIT_HEALTH);
    }
    bars.remove(player.getUniqueId());
    noFall.remove(player.getUniqueId());
    frozen.remove(player.getUniqueId());
    lastPositions.remove(player.getUniqueId());
    kitWorld.clear(player);
    if (invisible.remove(player.getUniqueId())) {
      player.setInvisible(false);
      player.setArrowsInBody(0, false);
    }
    arrows.forget(player.getUniqueId());
    skins.undress(player);
    reveal(player);
    if (disguised.remove(player.getUniqueId()) != null) {
      context.guarded(
          "take off a worn name", () -> displays.wear(player, java.util.Optional.empty()));
    }
    boards.looks(player, false, java.util.Optional.empty());
  }

  /** The match reset: every placed block goes back and nothing is remembered. */
  void reset() {
    for (var at : Set.copyOf(placed.keySet())) {
      clear(at);
    }
    bars.clear();
    noFall.clear();
    frozen.clear();
    lastPositions.clear();
    displays.clear();
    projectiles.clear();
    invisible.clear();
    hiddenFrom.clear();
    disguised.clear();
    arrows.clear();
    skins.reset();
    kitWorld.reset();
    streaks.reset();
  }

  /** The Batch D and new kits' world, for tests and listeners. */
  KitWorld world() {
    return kitWorld;
  }
}
