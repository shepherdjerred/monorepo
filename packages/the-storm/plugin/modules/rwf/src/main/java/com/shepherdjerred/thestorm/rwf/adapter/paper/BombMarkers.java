package com.shepherdjerred.thestorm.rwf.adapter.paper;

import com.shepherdjerred.thestorm.rwf.domain.combatant.TeamColor;
import com.shepherdjerred.thestorm.rwf.domain.map.BombSite;
import com.shepherdjerred.thestorm.rwf.domain.map.MapDefinition;
import com.shepherdjerred.thestorm.rwf.domain.match.MatchSnapshot;
import java.util.HashMap;
import java.util.Map;
import java.util.Optional;
import java.util.function.Consumer;
import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.format.NamedTextColor;
import org.bukkit.Material;
import org.bukkit.Particle;
import org.bukkit.Sound;
import org.bukkit.World;
import org.bukkit.entity.Display;
import org.bukkit.entity.Entity;
import org.bukkit.entity.TNTPrimed;
import org.bukkit.entity.TextDisplay;
import org.bukkit.event.entity.CreatureSpawnEvent.SpawnReason;
import org.bukkit.util.Vector;

/**
 * What a bomb looks like in the world: the TNT block while idle, primed TNT floating on the spot
 * while armed (its fuse is the match's, never the entity's), and a hologram above it naming the
 * owner and showing arming progress or the seconds left. Main thread only.
 */
final class BombMarkers {

  /** Far longer than any match: the primed TNT never explodes on its own. */
  static final int ENTITY_FUSE_TICKS = 24 * 60 * 60 * 20;

  private static final double HOLOGRAM_HEIGHT = 1.6;

  private final PaperContext context;
  private final Keys keys;
  private final Consumer<Display> style;
  private final Map<String, TNTPrimed> primed = new HashMap<>();
  private final Map<String, TextDisplay> holograms = new HashMap<>();
  private final Map<String, BombSite> sites = new HashMap<>();

  BombMarkers(PaperContext context, Keys keys, Consumer<Display> style) {
    this.context = context;
    this.keys = keys;
    this.style = style;
  }

  private World world() {
    return context.world();
  }

  /** Removes every bomb entity left in the world by a crash. */
  void cleanUp() {
    for (var entity : world().getEntities()) {
      if (keys.bombOf(entity).isPresent()) {
        entity.remove();
      }
    }
  }

  /** The match went live on {@code map}: holograms stand over every site. */
  void place(MapDefinition map) {
    clear();
    for (var site : map.bombs()) {
      sites.put(site.id(), site);
      var at = Places.center(world(), site.position()).add(0, HOLOGRAM_HEIGHT, 0);
      var hologram =
          world()
              .spawn(
                  at,
                  TextDisplay.class,
                  display -> {
                    display.text(title(site));
                    display.setPersistent(false);
                    style.accept(display);
                    keys.tagBomb(display, site.id());
                  },
                  SpawnReason.CUSTOM);
      holograms.put(site.id(), hologram);
    }
  }

  /** The bomb {@code entity} stands for, if it is one of ours. */
  Optional<String> bombOf(Entity entity) {
    return keys.bombOf(entity);
  }

  /** The site whose block is {@code position}, if any is placed. */
  Optional<BombSite> siteAt(com.shepherdjerred.thestorm.rwf.domain.geometry.BlockPos position) {
    return sites.values().stream().filter(site -> site.position().equals(position)).findFirst();
  }

  /** The TNT block becomes primed TNT with a long fuse that the match, not the entity, ends. */
  void arm(String bombId) {
    var site = site(bombId);
    Places.block(world(), site.position()).setType(Material.AIR, false);
    removePrimed(bombId);
    var tnt =
        world()
            .spawn(
                Places.center(world(), site.position()),
                TNTPrimed.class,
                entity -> {
                  entity.setFuseTicks(ENTITY_FUSE_TICKS);
                  entity.setGravity(false);
                  // Vanilla gives fresh primed TNT a random sideways push and
                  // 0.2 upward; without gravity it would drift out of reach.
                  entity.setVelocity(new Vector());
                  entity.setInvulnerable(true);
                  entity.setPersistent(false);
                  keys.tagBomb(entity, bombId);
                },
                SpawnReason.CUSTOM);
    primed.put(bombId, tnt);
  }

  /** The TNT block is back. */
  void restore(String bombId) {
    var site = site(bombId);
    removePrimed(bombId);
    Places.block(world(), site.position()).setType(Material.TNT, false);
  }

  /** The bomb is gone for the rest of the match. */
  void remove(String bombId) {
    var site = site(bombId);
    removePrimed(bombId);
    Places.block(world(), site.position()).setType(Material.AIR, false);
    var hologram = holograms.remove(bombId);
    if (hologram != null) {
      hologram.remove();
    }
  }

  /** The fuse ran out: a bang at the site; the crater is the map's job. */
  void explode(String bombId) {
    var site = site(bombId);
    removePrimed(bombId);
    var at = Places.center(world(), site.position());
    world().spawnParticle(Particle.EXPLOSION_EMITTER, at, 3);
    world().playSound(at, Sound.ENTITY_GENERIC_EXPLODE, 4, 1);
  }

  /** Updates every hologram from {@code snapshot} and keeps armed TNT pinned to its site. */
  void update(MatchSnapshot snapshot) {
    for (var entry : primed.entrySet()) {
      var site = sites.get(entry.getKey());
      var tnt = entry.getValue();
      if (site == null || !tnt.isValid()) {
        continue;
      }
      var home = Places.center(world(), site.position());
      if (tnt.getLocation().distanceSquared(home) > 0.01 || tnt.getVelocity().lengthSquared() > 0) {
        tnt.setVelocity(new Vector());
        tnt.teleport(home);
      }
    }
    for (var view : snapshot.bombs()) {
      var hologram = holograms.get(view.id());
      var site = sites.get(view.id());
      if (hologram == null || site == null) {
        continue;
      }
      hologram.text(title(site).appendNewline().append(state(view)));
    }
  }

  private static Component title(BombSite site) {
    return site.owner()
        .team()
        .map(team -> Component.text(team.displayName() + "'s Bomb", Scoreboards.color(team)))
        .orElseGet(() -> Component.text("Nuke", NamedTextColor.GOLD));
  }

  private static Component state(MatchSnapshot.BombView view) {
    return switch (view.state()) {
      case MatchSnapshot.BombView.State.Idle _ -> Component.text("Idle", NamedTextColor.GRAY);
      case MatchSnapshot.BombView.State.Arming arming ->
          Component.text(
              arming.team().shortName() + " arming " + Math.round(arming.progress() * 100) + "%",
              NamedTextColor.YELLOW);
      case MatchSnapshot.BombView.State.Armed armed ->
          armed
              .defusing()
              .map(
                  defusing ->
                      Component.text(
                          defusing.team().shortName()
                              + " defusing "
                              + Math.round(defusing.progress() * 100)
                              + "%",
                          NamedTextColor.AQUA))
              .orElseGet(
                  () ->
                      Component.text(
                          "Armed by "
                              + view.team().map(TeamColor::shortName).orElse("?")
                              + ": "
                              + armed.remaining()
                              + "s",
                          NamedTextColor.RED));
      case MatchSnapshot.BombView.State.Destroyed _ ->
          Component.text("Destroyed", NamedTextColor.DARK_GRAY);
    };
  }

  /** Removes every entity and forgets the map. */
  void clear() {
    primed.values().forEach(Entity::remove);
    primed.clear();
    holograms.values().forEach(Entity::remove);
    holograms.clear();
    sites.clear();
  }

  private void removePrimed(String bombId) {
    var tnt = primed.remove(bombId);
    if (tnt != null) {
      tnt.remove();
    }
  }

  private BombSite site(String bombId) {
    var site = sites.get(bombId);
    if (site == null) {
      throw new IllegalStateException("no bomb " + bombId + " is placed");
    }
    return site;
  }
}
