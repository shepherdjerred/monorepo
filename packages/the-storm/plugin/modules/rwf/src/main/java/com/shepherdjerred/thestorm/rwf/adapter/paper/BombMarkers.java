package com.shepherdjerred.thestorm.rwf.adapter.paper;

import com.shepherdjerred.thestorm.rwf.domain.ability.kits.Saboteur;
import com.shepherdjerred.thestorm.rwf.domain.combatant.TeamColor;
import com.shepherdjerred.thestorm.rwf.domain.map.BombSite;
import com.shepherdjerred.thestorm.rwf.domain.map.MapDefinition;
import com.shepherdjerred.thestorm.rwf.domain.match.MatchSnapshot;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.function.BooleanSupplier;
import java.util.function.Consumer;
import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.format.NamedTextColor;
import net.kyori.adventure.text.format.TextDecoration;
import org.bukkit.Material;
import org.bukkit.Particle;
import org.bukkit.Sound;
import org.bukkit.World;
import org.bukkit.entity.Display;
import org.bukkit.entity.Entity;
import org.bukkit.entity.Player;
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
  private final Map<String, TextDisplay> concealed = new HashMap<>();
  private final Map<String, Set<UUID>> hiddenFrom = new HashMap<>();
  private final Map<String, TeamColor> armers = new HashMap<>();

  /**
   * Who looks at the bombs and which teams have a Saboteur alive, for {@link #update(MatchSnapshot,
   * Sabotage)}.
   *
   * @param viewers every combatant's entity with their team
   * @param sabotaging the teams with a living Saboteur
   */
  record Sabotage(Map<Player, TeamColor> viewers, Set<TeamColor> sabotaging) {

    /** Nobody sabotaging. */
    static final Sabotage NONE = new Sabotage(Map.of(), Set.of());

    Sabotage {
      viewers = Map.copyOf(viewers);
      sabotaging = Set.copyOf(sabotaging);
    }

    /** Who watches {@code runner}'s bombs, and which of its teams have a Saboteur alive. */
    static Sabotage of(MatchRunner runner) {
      var viewers = new HashMap<Player, TeamColor>();
      var sabotaging = new HashSet<TeamColor>();
      for (var member : runner.match().members()) {
        if (member.team().isEmpty()) {
          continue;
        }
        var team = member.team().orElseThrow();
        runner.entity(member.id()).ifPresent(player -> viewers.put(player, team));
        if (member.alive() && member.kit().filter(Saboteur.ID::equals).isPresent()) {
          sabotaging.add(team);
        }
      }
      return new Sabotage(viewers, sabotaging);
    }
  }

  private BooleanSupplier original = () -> false;

  BombMarkers(PaperContext context, Keys keys, Consumer<Display> style) {
    this.context = context;
    this.keys = keys;
    this.style = style;
  }

  /** Whether bombs look and sound as Red Warfare's did, read as each effect plays. */
  void effects(BooleanSupplier originalEffects) {
    this.original = originalEffects;
  }

  private World world() {
    return context.mapWorld();
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
    context
        .blocks()
        .set(
            "#storm-rwf-bomb",
            Places.block(world(), site.position()),
            Material.AIR.createBlockData(),
            false);
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
    context
        .blocks()
        .set(
            "#storm-rwf-bomb",
            Places.block(world(), site.position()),
            Material.TNT.createBlockData(),
            false);
  }

  /** The bomb is gone for the rest of the match. */
  void remove(String bombId) {
    var site = site(bombId);
    removePrimed(bombId);
    context
        .blocks()
        .set(
            "#storm-rwf-bomb",
            Places.block(world(), site.position()),
            Material.AIR.createBlockData(),
            false);
    var hologram = holograms.remove(bombId);
    if (hologram != null) {
      hologram.remove();
    }
    uncover(bombId);
  }

  /** The fuse ran out: a bang at the site; the crater is the map's job. */
  void explode(String bombId) {
    var site = site(bombId);
    removePrimed(bombId);
    var at = Places.center(world(), site.position());
    if (original.getAsBoolean()) {
      // Red Warfare's huge explosion, heard across the whole map.
      world().spawnParticle(Particle.EXPLOSION_EMITTER, at, 1);
      world().playSound(at, Sound.ENTITY_GENERIC_EXPLODE, Sounds.MAP_WIDE, 0);
      return;
    }
    world().spawnParticle(Particle.EXPLOSION_EMITTER, at, 3);
    world().playSound(at, Sound.ENTITY_GENERIC_EXPLODE, 4, 1);
  }

  /** Updates every hologram from {@code snapshot} and keeps armed TNT pinned to its site. */
  void update(MatchSnapshot snapshot) {
    update(snapshot, Sabotage.NONE);
  }

  /**
   * Updates every hologram from {@code snapshot}, hiding a Saboteur team's progress from the
   * viewers {@link Saboteur#hides} names, and keeps armed TNT pinned to its site.
   */
  void update(MatchSnapshot snapshot, Sabotage sabotage) {
    conceal(snapshot, sabotage);
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
      hologram.text(
          original.getAsBoolean() && !view.progress().isEmpty() ? bars(view) : text(site, view));
    }
  }

  /**
   * Red Warfare's hologram while teams work on a bomb ({@code TeamBomb.drawHologram}): one
   * ten-segment bar per team, filled in the team's colour and the rest dark red.
   */
  static Component bars(MatchSnapshot.BombView view) {
    var text = Component.text();
    var first = true;
    for (var arming : view.progress()) {
      if (!first) {
        text.appendNewline();
      }
      first = false;
      text.append(Scoreboards.bar(arming, "█"));
    }
    return text.build();
  }

  /**
   * Red Warfare's hologram otherwise: "Exploding in N" in the owner's (for a nuke, the armer's)
   * colour while it burns, else the team's bomb, or an unarmed nuke.
   */
  static Component text(BombSite site, MatchSnapshot.BombView view) {
    if (view.state() instanceof MatchSnapshot.BombView.State.Armed armed) {
      var color = view.team().map(Scoreboards::color).orElse(NamedTextColor.WHITE);
      return Component.text("Exploding in ", color, TextDecoration.BOLD)
          .append(
              Component.text(
                  String.valueOf(armed.remaining()), NamedTextColor.DARK_RED, TextDecoration.BOLD));
    }
    return title(site);
  }

  private static Component title(BombSite site) {
    return site.owner()
        .team()
        .map(
            team ->
                Component.text(
                    team.displayName() + "'s Bomb", Scoreboards.color(team), TextDecoration.BOLD))
        .orElseGet(() -> Component.text("Unarmed nuke", NamedTextColor.WHITE));
  }

  /** Shows each viewer the true hologram or, while a Saboteur hides it from them, a blank one. */
  private void conceal(MatchSnapshot snapshot, Sabotage sabotage) {
    for (var view : snapshot.bombs()) {
      remember(view);
      var main = holograms.get(view.id());
      var site = sites.get(view.id());
      if (main == null || site == null) {
        continue;
      }
      var hidden = hiddenFrom(view, sabotage);
      if (hidden.isEmpty()) {
        uncover(view.id());
      } else {
        cover(view.id(), main, site, hidden);
      }
    }
  }

  /** Keeps the last team seen arming {@code view}: an armed bomb's state names only its owner. */
  private void remember(MatchSnapshot.BombView view) {
    switch (view.state()) {
      case MatchSnapshot.BombView.State.Arming arming -> armers.put(view.id(), arming.team());
      case MatchSnapshot.BombView.State.Idle _, MatchSnapshot.BombView.State.Destroyed _ ->
          armers.remove(view.id());
      case MatchSnapshot.BombView.State.Armed _ -> {}
    }
  }

  /** Whether a Saboteur keeps a bomb's progress from a team, for the teams' sidebars. */
  java.util.function.BiPredicate<MatchSnapshot.BombView, TeamColor> concealed(Sabotage sabotage) {
    return (view, team) ->
        Saboteur.hides(
            view, Optional.ofNullable(armers.get(view.id())), team, sabotage.sabotaging());
  }

  /** The viewers a Saboteur keeps from {@code view}'s progress. */
  private Set<UUID> hiddenFrom(MatchSnapshot.BombView view, Sabotage sabotage) {
    var armer = Optional.ofNullable(armers.get(view.id()));
    var hidden = new HashSet<UUID>();
    sabotage
        .viewers()
        .forEach(
            (viewer, team) -> {
              if (Saboteur.hides(view, armer, team, sabotage.sabotaging())) {
                hidden.add(viewer.getUniqueId());
              }
            });
    return hidden;
  }

  /** {@code hidden} see a blank hologram over {@code bombId}; everyone else, the true one. */
  private void cover(String bombId, TextDisplay main, BombSite site, Set<UUID> hidden) {
    var blank =
        concealed.computeIfAbsent(
            bombId,
            id ->
                world()
                    .spawn(
                        main.getLocation(),
                        TextDisplay.class,
                        display -> {
                          display.setPersistent(false);
                          style.accept(display);
                          keys.tagBomb(display, id);
                        },
                        SpawnReason.CUSTOM));
    blank.text(
        title(site)
            .appendNewline()
            .append(Component.text("Something is happening...", NamedTextColor.GRAY)));
    for (var player : world().getPlayers()) {
      var hide = hidden.contains(player.getUniqueId());
      show(player, main, !hide);
      show(player, blank, hide);
    }
    hiddenFrom.put(bombId, hidden);
  }

  private void show(Player player, Entity display, boolean visible) {
    if (visible) {
      player.showEntity(context.plugin(), display);
    } else {
      player.hideEntity(context.plugin(), display);
    }
  }

  /** Nobody is kept from {@code bombId}'s progress any more. */
  private void uncover(String bombId) {
    var blank = concealed.remove(bombId);
    if (blank != null) {
      blank.remove();
    }
    var hidden = hiddenFrom.remove(bombId);
    var main = holograms.get(bombId);
    if (hidden == null || main == null) {
      return;
    }
    for (var player : world().getPlayers()) {
      if (hidden.contains(player.getUniqueId())) {
        player.showEntity(context.plugin(), main);
      }
    }
  }

  /** Removes every entity and forgets the map. */
  void clear() {
    concealed.values().forEach(Entity::remove);
    concealed.clear();
    hiddenFrom.clear();
    armers.clear();
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
