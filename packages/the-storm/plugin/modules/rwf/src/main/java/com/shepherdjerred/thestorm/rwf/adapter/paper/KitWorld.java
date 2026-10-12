package com.shepherdjerred.thestorm.rwf.adapter.paper;

import com.shepherdjerred.thestorm.rwf.domain.ability.AbilityEffect;
import com.shepherdjerred.thestorm.rwf.domain.ability.KitCombat;
import com.shepherdjerred.thestorm.rwf.domain.ability.kits.Tracker;
import com.shepherdjerred.thestorm.rwf.domain.combat.DamageFormula;
import com.shepherdjerred.thestorm.rwf.domain.combatant.CombatantId;
import com.shepherdjerred.thestorm.rwf.domain.combatant.TeamColor;
import com.shepherdjerred.thestorm.rwf.domain.geometry.Vec3;
import com.shepherdjerred.thestorm.rwf.domain.match.Combatant;
import io.papermc.paper.datacomponent.item.ResolvableProfile;
import io.papermc.paper.registry.RegistryAccess;
import io.papermc.paper.registry.RegistryKey;
import java.time.Instant;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.EnumMap;
import java.util.HashMap;
import java.util.Map;
import java.util.Optional;
import net.kyori.adventure.key.Key;
import org.bukkit.Color;
import org.bukkit.Location;
import org.bukkit.Material;
import org.bukkit.Particle;
import org.bukkit.enchantments.Enchantment;
import org.bukkit.entity.BlockDisplay;
import org.bukkit.entity.Mannequin;
import org.bukkit.entity.Player;
import org.bukkit.event.entity.CreatureSpawnEvent.SpawnReason;
import org.bukkit.inventory.EquipmentSlot;
import org.bukkit.inventory.ItemStack;
import org.bukkit.util.Transformation;
import org.joml.AxisAngle4f;
import org.joml.Vector3f;

/**
 * What the Batch D and new kits leave in the world and on players: a Dwarf's enchanted gear, damage
 * a kit deals its own holder (an Inertia's wall), a Spotter's glow seen by one team only, a
 * Tracker's compass marks and footprints, and a Decoy's running copy. Everything is gone at reset.
 * Main thread only.
 */
final class KitWorld {

  /** A Decoy's copy runs at sprinting speed, in blocks a tick. */
  private static final double DECOY_SPEED = 0.28;

  /** How often, in ticks, footprints are laid and drawn and compasses turned. */
  private static final int STRIDE = 5;

  /** A footprint's dust. */
  private static final Particle.DustOptions PRINT =
      new Particle.DustOptions(Color.fromRGB(60, 40, 20), 0.8F);

  /**
   * A glow one team sees.
   *
   * @param display the glowing outline that follows the target
   * @param until when it goes out
   */
  private record Glowing(BlockDisplay display, Instant until) {}

  /**
   * A Decoy's running copy.
   *
   * @param copy the mannequin
   * @param direction where it runs
   * @param until when it vanishes
   */
  private record Copy(Mannequin copy, Vec3 direction, Instant until) {}

  /**
   * A footprint.
   *
   * @param owner whose
   * @param team their team
   * @param at where
   * @param time when
   */
  private record Print(CombatantId owner, TeamColor team, Location at, Instant time) {}

  private final MatchRunner runner;
  private final PaperContext context;
  private final CombatTracker tracker;
  private final Map<CombatantId, Map<TeamColor, Glowing>> glows = new HashMap<>();
  private final Map<TeamColor, CombatantId> marks = new EnumMap<>(TeamColor.class);
  private final Map<CombatantId, Copy> copies = new HashMap<>();
  private final ArrayDeque<Print> prints = new ArrayDeque<>();
  private long ticks;

  KitWorld(MatchRunner runner, PaperContext context, CombatTracker tracker) {
    this.runner = runner;
    this.context = context;
    this.tracker = tracker;
  }

  // ---- effects -------------------------------------------------------------------------------

  /**
   * A Dwarf's level enchants what it carries as Red Warfare's {@code onChange} did: every item in
   * its inventory, armour and off hand included, takes each enchantment it can hold, except a
   * leather chestplate; the item on its cursor too.
   */
  void gear(AbilityEffect.Gear gear) {
    runner
        .entity(gear.id())
        .ifPresent(
            player -> {
              var levels =
                  Map.of(
                      enchantment("sharpness"), gear.sharpness(),
                      enchantment("protection"), gear.protection(),
                      enchantment("blast_protection"), gear.blastProtection());
              var inventory = player.getInventory();
              for (var slot = 0; slot < inventory.getSize(); slot++) {
                var item = inventory.getItem(slot);
                if (item != null && enchant(item, levels)) {
                  inventory.setItem(slot, item);
                }
              }
              var cursor = player.getItemOnCursor();
              if (enchant(cursor, levels)) {
                player.setItemOnCursor(cursor);
              }
            });
  }

  /** Enchants {@code item} at {@code levels} where it can be; whether it changed. */
  private static boolean enchant(ItemStack item, Map<Enchantment, Integer> levels) {
    if (item.isEmpty() || item.getType() == Material.LEATHER_CHESTPLATE) {
      return false;
    }
    var changed = false;
    for (var entry : levels.entrySet()) {
      if (entry.getKey().canEnchantItem(item)) {
        level(item, entry.getKey(), entry.getValue());
        changed = true;
      }
    }
    return changed;
  }

  private static void level(ItemStack item, Enchantment enchantment, int level) {
    if (level <= 0) {
      item.removeEnchantment(enchantment);
    } else {
      item.addUnsafeEnchantment(enchantment, level);
    }
  }

  private static Enchantment enchantment(String key) {
    var found =
        RegistryAccess.registryAccess().getRegistry(RegistryKey.ENCHANTMENT).get(Key.key(key));
    if (found == null) {
      throw new IllegalStateException("no enchantment " + key);
    }
    return found;
  }

  /** Damage a kit deals its own holder, through the combat rules and their kit. */
  void damage(AbilityEffect.Damage damage) {
    runner
        .entity(damage.id())
        .ifPresent(
            victim -> {
              var side = runner.kits().side(victim.getUniqueId());
              if (side.isEmpty() || victim.isDead()) {
                return;
              }
              var hit =
                  DamageFormula.Hit.of(damage.cause(), damage.amount(), KitFactory.armor(victim));
              var dealt =
                  KitCombat.damage(
                      hit,
                      Optional.empty(),
                      side.orElseThrow(),
                      runner.match().random(runner.now()));
              tracker.hit(victim, dealt, damage.by().map(CombatantId::uuid), damage.cause());
              victim.setHealth(Math.max(0, victim.getHealth() - dealt));
            });
  }

  /** {@code glow.target()} glows for {@code glow.team()} only. */
  void glow(AbilityEffect.Glow glow) {
    var target = runner.entity(glow.target());
    if (target.isEmpty()) {
      return;
    }
    var byTeam = glows.computeIfAbsent(glow.target(), ignored -> new EnumMap<>(TeamColor.class));
    var existing = byTeam.get(glow.team());
    var until = runner.now().plus(glow.length());
    if (existing != null) {
      byTeam.put(glow.team(), new Glowing(existing.display(), until));
      return;
    }
    var display =
        context
            .mapWorld()
            .spawn(
                Places.at(target.orElseThrow()),
                BlockDisplay.class,
                d -> {
                  d.setBlock(Material.GLASS.createBlockData());
                  d.setTransformation(
                      new Transformation(
                          new Vector3f(-0.35F, 0, -0.35F),
                          new AxisAngle4f(),
                          new Vector3f(0.7F, 1.9F, 0.7F),
                          new AxisAngle4f()));
                  d.setGlowing(true);
                  d.setGlowColorOverride(Color.fromRGB(Scoreboards.color(glow.team()).value()));
                  d.setPersistent(false);
                },
                SpawnReason.CUSTOM);
    showOnlyTo(display, glow.team());
    byTeam.put(glow.team(), new Glowing(display, until));
  }

  private void showOnlyTo(org.bukkit.entity.Entity display, TeamColor team) {
    for (var member : runner.match().members()) {
      runner
          .entity(member.id())
          .ifPresent(
              player -> {
                if (member.onTeam(team)) {
                  player.showEntity(context.plugin(), display);
                } else {
                  player.hideEntity(context.plugin(), display);
                }
              });
    }
  }

  /** {@code team}'s compasses point at {@code target} from now on. */
  void mark(AbilityEffect.Mark mark) {
    marks.put(mark.team(), mark.target());
  }

  /** A Decoy's copy starts running. */
  void decoy(AbilityEffect.Decoy decoy) {
    var owner = runner.entity(decoy.id());
    if (owner.isEmpty()) {
      return;
    }
    removeCopy(decoy.id());
    var player = owner.orElseThrow();
    var at = Places.at(player);
    at.setDirection(Places.vector(decoy.direction()));
    var copy =
        context
            .mapWorld()
            .spawn(
                at,
                Mannequin.class,
                m -> {
                  m.setProfile(ResolvableProfile.resolvableProfile(player.getPlayerProfile()));
                  m.setInvulnerable(true);
                  m.setPersistent(false);
                  var equipment = m.getEquipment();
                  for (var slot :
                      new EquipmentSlot[] {
                        EquipmentSlot.HEAD,
                        EquipmentSlot.CHEST,
                        EquipmentSlot.LEGS,
                        EquipmentSlot.FEET,
                        EquipmentSlot.HAND
                      }) {
                    equipment.setItem(slot, player.getInventory().getItem(slot).clone());
                  }
                },
                SpawnReason.CUSTOM);
    copies.put(decoy.id(), new Copy(copy, decoy.direction(), runner.now().plus(decoy.length())));
  }

  // ---- the clock -----------------------------------------------------------------------------

  void tick(Instant now) {
    ticks++;
    glows();
    copies(now);
    if (ticks % STRIDE == 0) {
      footprints(now);
      compasses();
    }
  }

  private void glows() {
    for (var target : new ArrayList<>(glows.keySet())) {
      var byTeam = glows.getOrDefault(target, Map.of());
      var entity = runner.entity(target).filter(p -> runner.fighting(p.getUniqueId()));
      for (var team : new ArrayList<>(byTeam.keySet())) {
        follow(byTeam, team, entity);
      }
      if (byTeam.isEmpty()) {
        glows.remove(target);
      }
    }
  }

  /** {@code team}'s glow follows its target, or goes out when its time or its target is gone. */
  private void follow(Map<TeamColor, Glowing> byTeam, TeamColor team, Optional<Player> target) {
    var glowing = byTeam.get(team);
    if (glowing == null) {
      return;
    }
    if (target.isEmpty() || !runner.now().isBefore(glowing.until())) {
      glowing.display().remove();
      byTeam.remove(team);
    } else {
      glowing.display().teleport(Places.at(target.orElseThrow()));
    }
  }

  private void copies(Instant now) {
    for (var entry : new ArrayList<>(copies.entrySet())) {
      var copy = entry.getValue();
      if (!now.isBefore(copy.until()) || !copy.copy().isValid()) {
        removeCopy(entry.getKey());
        continue;
      }
      var at = copy.copy().getLocation();
      var next = at.clone().add(Places.vector(copy.direction().scaled(DECOY_SPEED)));
      if (next.getBlock().getType().isSolid()) {
        var step = next.clone().add(0, 1, 0);
        if (step.getBlock().getType().isSolid()
            || step.clone().add(0, 1, 0).getBlock().getType().isSolid()) {
          continue;
        }
        next = step;
      } else if (!next.clone().add(0, -1, 0).getBlock().getType().isSolid()) {
        next.add(0, -0.5, 0);
      }
      next.setDirection(Places.vector(copy.direction()));
      copy.copy().teleport(next);
    }
  }

  /** Every living fighter leaves a footprint; Trackers see the enemy's from the last 8 seconds. */
  private void footprints(Instant now) {
    for (var member : runner.match().members()) {
      if (member.alive() && member.team().isPresent()) {
        var team = member.team().orElseThrow();
        runner
            .entity(member.id())
            .ifPresent(
                player ->
                    prints.add(
                        new Print(member.id(), team, Places.at(player).add(0, 0.05, 0), now)));
      }
    }
    while (!prints.isEmpty() && prints.peekFirst().time().plus(Tracker.TRAIL).isBefore(now)) {
      prints.removeFirst();
    }
    for (var member : runner.match().members()) {
      if (member.alive() && member.kit().filter(Tracker.ID::equals).isPresent()) {
        var team = member.team().orElseThrow();
        runner.entity(member.id()).ifPresent(viewer -> draw(viewer, team));
      }
    }
  }

  /** {@code viewer}, a Tracker on {@code team}, sees the enemy's footprints. */
  private void draw(Player viewer, TeamColor team) {
    for (var print : prints) {
      if (print.team() != team) {
        viewer.spawnParticle(Particle.DUST, print.at(), 1, PRINT);
      }
    }
  }

  private void compasses() {
    for (var entry : new ArrayList<>(marks.entrySet())) {
      var target =
          runner
              .member(entry.getValue())
              .filter(Combatant::alive)
              .flatMap(c -> runner.entity(c.id()));
      if (target.isEmpty()) {
        marks.remove(entry.getKey());
        continue;
      }
      for (var member : runner.match().members()) {
        if (member.alive() && member.onTeam(entry.getKey())) {
          runner
              .entity(member.id())
              .ifPresent(player -> player.setCompassTarget(Places.at(target.orElseThrow())));
        }
      }
    }
  }

  private void removeCopy(CombatantId id) {
    var copy = copies.remove(id);
    if (copy != null) {
      copy.copy().remove();
    }
  }

  /** The team a marked enemy shows on, for tests. */
  Optional<CombatantId> marked(TeamColor team) {
    return Optional.ofNullable(marks.get(team));
  }

  // ---- clearing ------------------------------------------------------------------------------

  /** {@code player} left the fight: their copy goes and glows on them go out. */
  void clear(Player player) {
    runner.memberOf(player.getUniqueId()).map(Combatant::id).ifPresent(this::forget);
  }

  private void forget(CombatantId id) {
    removeCopy(id);
    var byTeam = glows.remove(id);
    if (byTeam != null) {
      byTeam.values().forEach(g -> g.display().remove());
    }
  }

  /** The match reset: everything goes. */
  void reset() {
    copies.values().forEach(copy -> copy.copy().remove());
    copies.clear();
    glows.values().forEach(byTeam -> byTeam.values().forEach(g -> g.display().remove()));
    glows.clear();
    marks.clear();
    prints.clear();
  }
}
