package com.shepherdjerred.thestorm.rwf.adapter.paper;

import com.shepherdjerred.thestorm.rwf.app.ListeningPost;
import com.shepherdjerred.thestorm.rwf.app.SmokeFields;
import com.shepherdjerred.thestorm.rwf.app.TacticalCasting;
import com.shepherdjerred.thestorm.rwf.app.TacticalReports;
import com.shepherdjerred.thestorm.rwf.app.VisualOcclusion;
import com.shepherdjerred.thestorm.rwf.app.view.Point;
import com.shepherdjerred.thestorm.rwf.domain.ability.TacticalEffect;
import com.shepherdjerred.thestorm.rwf.domain.ability.TacticalInput;
import com.shepherdjerred.thestorm.rwf.domain.ability.kits.Smokescreen;
import com.shepherdjerred.thestorm.rwf.domain.ability.kits.Tactician;
import com.shepherdjerred.thestorm.rwf.domain.ability.kits.Warden;
import com.shepherdjerred.thestorm.rwf.domain.combatant.CombatantId;
import com.shepherdjerred.thestorm.rwf.domain.match.Combatant;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;
import java.util.UUID;
import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.format.NamedTextColor;
import org.bukkit.Material;
import org.bukkit.Particle;
import org.bukkit.Sound;
import org.bukkit.entity.Player;

/** Nonphysical tactical fields, shared sound consumption and native item cues. Main thread only. */
final class TacticalWorld implements VisualOcclusion, TacticalCasting {
  private final MatchRunner runner;
  private final PaperContext context;
  private final SmokeFields smoke = new SmokeFields();
  private final Map<CombatantId, ListeningPost> posts = new HashMap<>();
  private long soundCursor;
  private long ticks;

  TacticalWorld(MatchRunner runner, PaperContext context) {
    this.runner = runner;
    this.context = context;
  }

  /** Both player clicks and bot item uses enter the same typed rule. */
  Optional<TacticalInput> input(Player player, Material material) {
    var at = Places.vec(Places.at(player));
    return switch (material) {
      case BUNDLE -> Optional.of(new TacticalInput.Supply(at));
      case CALIBRATED_SCULK_SENSOR -> Optional.of(new TacticalInput.Deploy(at));
      case GRAY_DYE -> Optional.of(new TacticalInput.Smoke(at));
      case GOAT_HORN -> Optional.of(new TacticalInput.Rally(at));
      default -> Optional.empty();
    };
  }

  void apply(TacticalEffect effect) {
    var now = runner.now();
    switch (effect) {
      case TacticalEffect.ListeningPost post -> {
        var at = point(post.at().x(), post.at().y(), post.at().z());
        var history = context.battleSounds().since(soundCursor);
        var baseline = history.isEmpty() ? soundCursor : history.getLast().sequence();
        posts.put(
            post.owner(), new ListeningPost(at, now, now.plus(Warden.LIFETIME), now, baseline));
      }
      case TacticalEffect.Smoke field ->
          smoke.add(
              new SmokeFields.Field(
                  field.owner().uuid(),
                  point(field.at().x(), field.at().y() + 1, field.at().z()),
                  Smokescreen.RADIUS,
                  now.plus(Smokescreen.LIFETIME)));
      case TacticalEffect.RallySignal signal ->
          runner
              .entity(signal.owner())
              .ifPresent(
                  player -> {
                    var sound =
                        signal.stage() == TacticalEffect.Stage.COMPLETE
                            ? Sound.ITEM_GOAT_HORN_SOUND_0
                            : Sound.BLOCK_NOTE_BLOCK_DIDGERIDOO;
                    if (signal.stage() != TacticalEffect.Stage.CANCELLED)
                      player.getWorld().playSound(Places.at(player), sound, 0.8F, 1);
                  });
    }
  }

  void tick(Instant now) {
    ticks++;
    if (!runner.live()) {
      reset();
      return;
    }
    smoke.expire(now);
    for (var field : smoke.fields()) {
      if (!runner.fighting(field.owner())) smoke.remove(field.owner());
    }
    posts
        .entrySet()
        .removeIf(
            entry ->
                !runner.fighting(entry.getKey().uuid()) || !now.isBefore(entry.getValue().until()));
    hear(now);
    if (ticks % 4 == 0) draw();
  }

  private void hear(Instant now) {
    for (var cue : context.battleSounds().since(soundCursor)) {
      soundCursor = cue.sequence();
      if (!cue.sound().world().equals(context.mapWorld().getUID())) continue;
      var source =
          runner.memberOf(cue.sound().source()).filter(member -> member.team().isPresent());
      if (source.isEmpty()) continue;
      for (var owner : new ArrayList<>(posts.keySet())) {
        var post = Objects.requireNonNull(posts.get(owner));
        var member = runner.member(owner);
        if (member.isPresent()
            && !member.orElseThrow().team().equals(source.orElseThrow().team())
            && post.hears(cue, now)) {
          report(owner, post, ListeningPost.approximate(cue.sound().position()));
          posts.put(owner, post.reported(now));
        }
      }
    }
  }

  private void report(CombatantId owner, ListeningPost post, Point at) {
    context.tacticalReports().emit(new TacticalReports.Report(owner.uuid(), at, 4));
    var team = runner.member(owner).flatMap(Combatant::team);
    var direction = direction(post.at(), at);
    for (var member : runner.match().members()) {
      if (member.alive() && member.team().equals(team))
        runner
            .entity(member.id())
            .ifPresent(
                player ->
                    player.sendActionBar(
                        Component.text(
                            "Listening post: enemy sound " + direction + ".",
                            NamedTextColor.AQUA)));
    }
  }

  private static String direction(Point from, Point to) {
    var dx = to.x() - from.x();
    var dz = to.z() - from.z();
    if (Math.abs(dx) < 2 && Math.abs(dz) < 2) return "nearby";
    var eastWest = dx >= 0 ? "east" : "west";
    var northSouth = dz >= 0 ? "south" : "north";
    if (Math.abs(dx) > Math.abs(dz) * 2) return "to the " + eastWest;
    if (Math.abs(dz) > Math.abs(dx) * 2) return "to the " + northSouth;
    return "to the " + northSouth + eastWest;
  }

  private void draw() {
    var world = context.mapWorld();
    for (var field : smoke.fields()) {
      var p = field.center();
      world.spawnParticle(Particle.CAMPFIRE_SIGNAL_SMOKE, p.x(), p.y(), p.z(), 80, 2, 1.5, 2, 0.01);
    }
    for (var post : posts.values()) {
      var p = post.at();
      world.spawnParticle(Particle.SCULK_SOUL, p.x(), p.y() + 0.2, p.z(), 2, 0.2, 0.2, 0.2, 0);
    }
  }

  @Override
  public boolean obscured(Point from, Point to) {
    return smoke.obscured(from, to);
  }

  @Override
  public java.util.List<VisualOcclusion.Field> snapshot() {
    return smoke.snapshot();
  }

  boolean smoky() {
    return smoke.active();
  }

  @Override
  public boolean stationary(UUID fighter) {
    return runner.live()
        && runner
            .memberOf(fighter)
            .filter(Combatant::alive)
            .map(member -> runner.match().abilities().state(member.id()))
            .filter(Tactician.State.class::isInstance)
            .map(Tactician.State.class::cast)
            .filter(state -> state.casting().isPresent())
            .isPresent();
  }

  void clear(Player player) {
    smoke.remove(player.getUniqueId());
    posts.keySet().removeIf(id -> id.uuid().equals(player.getUniqueId()));
  }

  void reset() {
    smoke.clear();
    posts.clear();
  }

  static Point point(double x, double y, double z) {
    return new Point(x, y, z);
  }
}
