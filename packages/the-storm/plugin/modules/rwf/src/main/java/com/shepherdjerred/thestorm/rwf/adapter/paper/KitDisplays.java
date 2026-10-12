// Ported from libraryaddict's Red Warfare
// (redwarfare-arcade/src/me/libraryaddict/arcade/game/searchanddestroy/abilities/Teleporter.java,
// its holograms, and TeleporterAbility.java, its particle links); see packages/the-storm/NOTICE.
package com.shepherdjerred.thestorm.rwf.adapter.paper;

import com.shepherdjerred.thestorm.rwf.domain.ability.Placed;
import com.shepherdjerred.thestorm.rwf.domain.ability.kits.Medic;
import com.shepherdjerred.thestorm.rwf.domain.combatant.TeamColor;
import com.shepherdjerred.thestorm.rwf.domain.geometry.BlockPos;
import java.time.Instant;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.ThreadLocalRandom;
import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.format.TextDecoration;
import org.bukkit.Effect;
import org.bukkit.Location;
import org.bukkit.Material;
import org.bukkit.Particle;
import org.bukkit.entity.Display;
import org.bukkit.entity.Player;
import org.bukkit.entity.TextDisplay;
import org.bukkit.event.entity.CreatureSpawnEvent.SpawnReason;

/**
 * The signs over kit things, shown only to those meant to read them: over each teleporter its team
 * sees whether it is connected or still stabilising and the enemy, from 12 blocks, sees an enemy
 * teleporter; acacia crumbs fall in a stabilising teleporter; and a dotted line in the team's
 * colour links a connected pair for any fighter beside one of them. Main thread only.
 */
final class KitDisplays {

  /** How far an enemy reads an enemy teleporter's sign, out of a display's 64 blocks. */
  private static final float ENEMY_RANGE = 12 / 64F;

  private static final double LINK_RANGE = 16;

  /**
   * One teleporter's two signs.
   *
   * @param team what its team reads
   * @param enemy what the enemy reads
   */
  private record Signs(TextDisplay team, TextDisplay enemy) {}

  private final MatchRunner runner;
  private final PaperContext context;
  private final Map<BlockPos, Signs> signs = new HashMap<>();
  private final Map<java.util.UUID, TextDisplay> worn = new HashMap<>();
  private final Map<java.util.UUID, TextDisplay> wornHealth = new HashMap<>();
  private final Map<java.util.UUID, Integer> wornPercent = new HashMap<>();
  private long ticks;

  /** Red Warfare's {@code _side}: which beat of the stabilising crumbs this tick is. */
  private int side;

  KitDisplays(MatchRunner runner, PaperContext context) {
    this.runner = runner;
    this.context = context;
  }

  void tick(Instant now) {
    ticks++;
    var teleporters =
        runner.match().abilities().placed().stream()
            .filter(Placed.Teleporter.class::isInstance)
            .map(Placed.Teleporter.class::cast)
            .toList();
    var standing = new HashSet<BlockPos>();
    for (var teleporter : teleporters) {
      standing.add(teleporter.block());
      var sign = signs.computeIfAbsent(teleporter.block(), at -> spawn(teleporter));
      sign.team().text(teamText(teleporter, teleporters, now));
      if (ticks % 10 == 0) {
        reveal(sign, teleporter.team());
      }
    }
    for (var at : new HashSet<>(signs.keySet())) {
      if (!standing.contains(at)) {
        var gone = signs.remove(at);
        if (gone != null) {
          remove(gone);
        }
      }
    }
    unstable(teleporters, now);
    link(teleporters);
  }

  /**
   * Red Warfare's stabilising teleporter: every other tick acacia crumbs fall in its doorway, twice
   * at the feet and then once at the head, over and over.
   */
  private void unstable(List<Placed.Teleporter> teleporters, Instant now) {
    side = (side + 1) % 6;
    if (side % 2 != 0) {
      return;
    }
    var log = Material.ACACIA_LOG.createBlockData();
    for (var teleporter : teleporters) {
      if (teleporter.unstable(now)) {
        var block = teleporter.block();
        var at = new Location(context.mapWorld(), block.x(), block.y() + 1 + side / 3, block.z());
        context.mapWorld().playEffect(at, Effect.DESTROY_BLOCK, log);
      }
    }
  }

  private Signs spawn(Placed.Teleporter teleporter) {
    var at = Places.center(context.mapWorld(), teleporter.block()).add(0, 1.5, 0);
    var color = Classic.color(teleporter.team());
    var team = text(at, Component.text("Not Connected", color, TextDecoration.BOLD), 1);
    var enemy =
        text(at, Component.text("Enemy Teleporter", color, TextDecoration.BOLD), ENEMY_RANGE);
    var sign = new Signs(team, enemy);
    reveal(sign, teleporter.team());
    return sign;
  }

  private TextDisplay text(Location at, Component text, float range) {
    return context
        .mapWorld()
        .spawn(
            at,
            TextDisplay.class,
            display -> {
              display.text(text);
              display.setBillboard(Display.Billboard.CENTER);
              display.setViewRange(range);
              display.setPersistent(false);
              display.setVisibleByDefault(false);
            },
            SpawnReason.CUSTOM);
  }

  /** Shows the team's sign to the team and the enemy's to everyone else in the match. */
  private void reveal(Signs sign, TeamColor team) {
    for (var member : runner.match().members()) {
      runner
          .entity(member.id())
          .ifPresent(
              player -> {
                var mine = member.onTeam(team);
                show(player, sign.team(), mine);
                show(player, sign.enemy(), !mine);
              });
    }
  }

  private void show(Player player, TextDisplay display, boolean visible) {
    if (visible) {
      player.showEntity(context.plugin(), display);
    } else {
      player.hideEntity(context.plugin(), display);
    }
  }

  private static Component teamText(
      Placed.Teleporter teleporter, List<Placed.Teleporter> all, Instant now) {
    var color = Classic.color(teleporter.team());
    if (teleporter.unstable(now)) {
      return Component.text("!!Stabalizing!!", color, TextDecoration.BOLD);
    }
    var pair = all.stream().filter(t -> t.owner().equals(teleporter.owner())).count();
    return pair == 2
        ? Component.text("Shift to teleport", color, TextDecoration.BOLD)
        : Component.text("Not Connected", color, TextDecoration.BOLD);
  }

  /**
   * Red Warfare's link between a connected pair, every tick, for each living fighter (of either
   * team) standing within 3.5 blocks across and 1.5 up or down of one of the pair: a short dense
   * stub out of each teleporter and a looser dotted line between the stubs, in the team's colour,
   * drawn only where they are within 16 blocks.
   */
  private void link(List<Placed.Teleporter> teleporters) {
    var byOwner = new HashMap<Object, List<Placed.Teleporter>>();
    for (var teleporter : teleporters) {
      byOwner
          .computeIfAbsent(teleporter.owner(), ignored -> new java.util.ArrayList<>())
          .add(teleporter);
    }
    var random = ThreadLocalRandom.current();
    for (var member : runner.match().members()) {
      if (!member.alive()) {
        continue;
      }
      var entity = runner.entity(member.id());
      if (entity.isEmpty()) {
        continue;
      }
      var player = entity.orElseThrow();
      for (var teleporter : teleporters) {
        var pair = byOwner.getOrDefault(teleporter.owner(), List.of());
        if (pair.size() == 2 && near(player, teleporter)) {
          draw(player, pair, random.nextDouble(-0.05, 0.05));
        }
      }
    }
  }

  /** Draws the link of {@code pair} for {@code player}, its middle spaced {@code 0.4 + jitter}. */
  private void draw(Player player, List<Placed.Teleporter> pair, double jitter) {
    var first = top(pair.get(0)).add(0, 0.6, 0);
    var second = top(pair.get(1)).add(0, 0.6, 0);
    var across = second.toVector().subtract(first.toVector()).setY(0).normalize();
    var firstStub = first.clone().add(across);
    var secondStub = second.clone().subtract(across);
    var points = new java.util.ArrayList<Location>();
    points.addAll(line(first, firstStub, 0.15));
    points.addAll(line(second, secondStub, 0.15));
    points.addAll(line(firstStub, secondStub, 0.4 + jitter));
    var dust = Classic.dust(pair.get(0).team());
    for (var point : points) {
      if (Places.at(player).distance(point) <= LINK_RANGE) {
        player.spawnParticle(Particle.DUST, point, 1, 0, 0, 0, 0, dust);
      }
    }
  }

  /** The middle of {@code teleporter}'s top face, where Red Warfare measured from. */
  private Location top(Placed.Teleporter teleporter) {
    var block = teleporter.block();
    return new Location(context.mapWorld(), block.x() + 0.5, block.y() + 1, block.z() + 0.5);
  }

  private boolean near(Player player, Placed.Teleporter teleporter) {
    var top = top(teleporter);
    var at = Places.at(player);
    return Math.abs(top.getY() - at.getY()) <= 1.5
        && Math.hypot(top.getX() - at.getX(), top.getZ() - at.getZ()) <= 3.5;
  }

  /**
   * Red Warfare's {@code drawLineDistanced}: {@code (int) (length / spacing)} evenly spaced points
   * from {@code from} towards {@code to}, {@code to} itself left out.
   */
  static List<Location> line(Location from, Location to, double spacing) {
    var points = (int) (from.distance(to) / spacing);
    var step = to.toVector().subtract(from.toVector()).multiply(1.0 / points);
    var out = new java.util.ArrayList<Location>();
    for (var i = 0; i < points; i++) {
      out.add(from.clone().add(step.clone().multiply(i)));
    }
    return out;
  }

  private static void remove(Signs sign) {
    sign.team().remove();
    sign.enemy().remove();
  }

  /**
   * {@code player} wears {@code disguise}'s name, in its team's colour, over their hidden name tag,
   * for the enemy only; none takes the worn name away. A Spy's disguise needs no sign: each
   * viewer's board already shows it in their own colour.
   */
  void wear(
      Player player,
      Optional<com.shepherdjerred.thestorm.rwf.domain.ability.AbilityEffect.Disguised> disguise) {
    var before = worn.remove(player.getUniqueId());
    if (before != null) {
      before.remove();
    }
    var health = wornHealth.remove(player.getUniqueId());
    if (health != null) {
      health.remove();
    }
    wornPercent.remove(player.getUniqueId());
    if (disguise.isEmpty() || disguise.orElseThrow().team().isEmpty()) {
      return;
    }
    var shown = disguise.orElseThrow();
    var name =
        text(
            Places.at(player).add(0, 2.3, 0),
            Component.text(shown.name(), Classic.color(shown.team().orElseThrow())),
            1);
    name.setBillboard(Display.Billboard.CENTER);
    player.addPassenger(name);
    var team = runner.memberOf(player.getUniqueId()).flatMap(m -> m.team());
    for (var member : runner.match().members()) {
      if (!member.team().equals(team)) {
        runner.entity(member.id()).ifPresent(enemy -> enemy.showEntity(context.plugin(), name));
      }
    }
    worn.put(player.getUniqueId(), name);
    // Red Warfare's Skinner wrote its health under the worn name on the enemy Medics' boards.
    var below = text(Places.at(player).add(0, 2.05, 0), Component.empty(), 1);
    below.setTransformation(
        new org.bukkit.util.Transformation(
            new org.joml.Vector3f(0, -BELOW_NAME, 0),
            new org.joml.Quaternionf(),
            new org.joml.Vector3f(1, 1, 1),
            new org.joml.Quaternionf()));
    player.addPassenger(below);
    for (var member : runner.match().members()) {
      if (!member.team().equals(team) && member.kit().filter(Medic.ID::equals).isPresent()) {
        runner.entity(member.id()).ifPresent(medic -> medic.showEntity(context.plugin(), below));
      }
    }
    wornHealth.put(player.getUniqueId(), below);
  }

  /** How far under a worn name its health line sits. */
  private static final float BELOW_NAME = 0.27F;

  /**
   * {@code player}'s health as the Medics' below-name score showed it, {@code ceil(health / max ×
   * 100)} then {@code % ❤}, under their worn name if they wear one.
   */
  void wornHealth(Player player, double health, double maxHealth) {
    var below = wornHealth.get(player.getUniqueId());
    if (below == null) {
      return;
    }
    var percent = (int) Math.ceil(health / maxHealth * 100);
    if (Integer.valueOf(percent).equals(wornPercent.put(player.getUniqueId(), percent))) {
      return;
    }
    below.text(
        Component.text(percent + " % ", net.kyori.adventure.text.format.NamedTextColor.WHITE)
            .append(Component.text("❤", net.kyori.adventure.text.format.NamedTextColor.DARK_RED)));
  }

  /** The match reset: every sign goes. */
  void clear() {
    signs.values().forEach(KitDisplays::remove);
    signs.clear();
    worn.values().forEach(TextDisplay::remove);
    worn.clear();
    wornHealth.values().forEach(TextDisplay::remove);
    wornHealth.clear();
    wornPercent.clear();
  }

  /** The sign over the teleporter at {@code at}, for tests. */
  Optional<TextDisplay> teamSign(BlockPos at) {
    return Optional.ofNullable(signs.get(at)).map(Signs::team);
  }
}
