package com.shepherdjerred.thestorm.e2e.maps;

import com.shepherdjerred.thestorm.TheStormPlugin;
import com.shepherdjerred.thestorm.core.config.ConfigFiles;
import com.shepherdjerred.thestorm.rwf.adapter.content.MapFile;
import com.shepherdjerred.thestorm.rwf.app.BotActions;
import com.shepherdjerred.thestorm.rwf.app.CombatantActions;
import com.shepherdjerred.thestorm.rwf.app.MatchView;
import com.shepherdjerred.thestorm.rwf.app.view.MatchState;
import com.shepherdjerred.thestorm.rwfbots.adapter.paper.IdMap;
import com.shepherdjerred.thestorm.rwfbots.adapter.paper.SnapshotCapture;
import com.shepherdjerred.thestorm.rwfbots.adapter.paper.StimulusCollector;
import com.shepherdjerred.thestorm.rwfbots.domain.map.TraversalCosts;
import com.shepherdjerred.thestorm.rwfbots.domain.tactics.FallRisk;
import com.shepherdjerred.thestorm.rwfbots.domain.world.CombatantView;
import io.papermc.paper.command.brigadier.BasicCommand;
import io.papermc.paper.command.brigadier.CommandSourceStack;
import io.papermc.paper.plugin.lifecycle.event.types.LifecycleEvents;
import java.util.ArrayList;
import java.util.IdentityHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import net.kyori.adventure.text.Component;
import org.bukkit.command.ConsoleCommandSender;
import org.bukkit.command.RemoteConsoleCommandSender;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.HandlerList;
import org.bukkit.event.Listener;
import org.bukkit.event.entity.EntityDamageByEntityEvent;
import org.bukkit.event.entity.EntityDamageEvent;
import org.bukkit.plugin.java.JavaPlugin;
import org.bukkit.potion.PotionEffect;
import org.bukkit.potion.PotionEffectType;
import org.bukkit.scheduler.BukkitTask;

/** Real joined-member capture and vanilla FALL diagnostics; no body controller is replaced. */
public final class HealthFixtures implements BasicCommand, Listener, AutoCloseable {
  private static final HealthProtocol WIRE = HealthProtocol.load();
  private final JavaPlugin plugin;
  private final IdMap ids = new IdMap();
  private final List<HealthProtocol.Sample> samples = new ArrayList<>();
  private final List<HealthProtocol.Fall> falls = new ArrayList<>();
  private final List<HealthProtocol.Setup> setups = new ArrayList<>();
  private final List<HealthProtocol.Prediction> predictions = new ArrayList<>();
  private final IdentityHashMap<EntityDamageEvent, HealthProtocol.Sample> before =
      new IdentityHashMap<>();
  private Optional<UUID> match = Optional.empty();
  private Optional<UUID> subject = Optional.empty();
  private Optional<UUID> world = Optional.empty();
  private Optional<HealthProtocol.Scenario> scenario = Optional.empty();
  private Optional<SnapshotCapture> capture = Optional.empty();
  private Optional<HealthCourse> course = Optional.empty();
  private Optional<BukkitTask> clock = Optional.empty();
  private String state = "idle";
  private long sequence;
  private int observedTicks;
  private int placements;
  private int pendingFalls;
  private boolean resistanceSeen;

  public HealthFixtures(JavaPlugin plugin) {
    this.plugin = plugin;
  }

  public void register() {
    plugin
        .getLifecycleManager()
        .registerEventHandler(
            LifecycleEvents.COMMANDS,
            event -> event.registrar().register("storm-fixture-health", this));
    plugin.getServer().getPluginManager().registerEvents(this, plugin);
  }

  @Override
  public void execute(CommandSourceStack source, String[] args) {
    if (!(source.getSender() instanceof ConsoleCommandSender
        || source.getSender() instanceof RemoteConsoleCommandSender))
      throw new IllegalArgumentException("health proof requires the disposable console");
    try {
      if (args.length == 1 && args[0].equals("contract")) {
        source
            .getSender()
            .sendMessage(Component.text(HealthProtocol.JSON.writeValueAsString(WIRE)));
        return;
      }
      command(args);
      source
          .getSender()
          .sendMessage(Component.text(HealthProtocol.JSON.writeValueAsString(status())));
    } catch (IllegalArgumentException | IllegalStateException failure) {
      state = "failed";
      source
          .getSender()
          .sendMessage(
              Component.text(
                  HealthProtocol.JSON.writeValueAsString(Map.of("error", failure.getMessage()))));
    }
  }

  private void command(String[] args) {
    if (args.length == 3 && args[0].equals("bind")) {
      bind(UUID.fromString(args[1]), args[2]);
      return;
    }
    if (args.length != 1)
      throw new IllegalArgumentException("use bind <player> <scenario>, place, status, or close");
    switch (args[0]) {
      case "place" -> place();
      case "status" -> {}
      case "close" -> finish();
      default -> throw new IllegalArgumentException("unknown health proof command");
    }
  }

  private TheStormPlugin storm() {
    var found = plugin.getServer().getPluginManager().getPlugin("TheStorm");
    if (!(found instanceof TheStormPlugin storm))
      throw new IllegalStateException("TheStorm missing");
    return storm;
  }

  private MatchView view() {
    return storm().service(MatchView.class);
  }

  private MatchState current() {
    return MatchState.of(view().current().orElseThrow());
  }

  private int tick() {
    return plugin.getServer().getCurrentTick();
  }

  private Player player() {
    var found = plugin.getServer().getPlayer(subject.orElseThrow());
    if (found == null) throw new IllegalStateException("original health subject disconnected");
    return found;
  }

  private void bind(UUID body, String selected) {
    if (!state.equals("idle"))
      throw new IllegalStateException("one original health case per server");
    var chosen =
        WIRE.scenarios().stream()
            .filter(value -> value.id().equals(selected))
            .findFirst()
            .orElseThrow(() -> new IllegalArgumentException("unknown health scenario"));
    var current = current();
    var fighter = current.combatant(body).orElseThrow();
    if (current.phase() != MatchState.Phase.COUNTDOWN
        || fighter.bot()
        || !current.mapId().filter("training-yard"::equals).isPresent())
      throw new IllegalStateException("bind requires the joined human Training Yard countdown");
    BotActions.over(storm().service(CombatantActions.class), view())
        .pickKit(body, chosen.kit())
        .ifPresent(
            refusal -> {
              throw new IllegalStateException("real kit selection refused: " + refusal);
            });
    subject = Optional.of(body);
    match = Optional.of(current.matchId());
    scenario = Optional.of(chosen);
    var port = view();
    capture =
        Optional.of(
            new SnapshotCapture(
                ids,
                id -> Optional.ofNullable(plugin.getServer().getPlayer(id)),
                new StimulusCollector(),
                new SnapshotCapture.Capabilities(
                    port::noFallUntil, () -> port.current().orElseThrow().now())));
    setup(
        "kit-selection",
        Map.of(
            "kit",
            chosen.kit(),
            "source",
            "real-lobby-action",
            "humanDemonstration",
            "false",
            "controls",
            "automated-native-client"));
    state = "bound";
    clock =
        Optional.of(plugin.getServer().getScheduler().runTaskTimer(plugin, this::observe, 1, 1));
  }

  private MatchState live() {
    var current = current();
    var fighter = current.combatant(subject.orElseThrow()).orElseThrow();
    if (match.filter(current.matchId()::equals).isEmpty()
        || current.phase() != MatchState.Phase.LIVE
        || !fighter.alive()
        || fighter.bot()
        || !fighter.kit().filter(scenario.orElseThrow().kit()::equals).isPresent())
      throw new IllegalStateException("health case lost its original live member or selected kit");
    if (player().isDead()
        || player().isInvulnerable()
        || player().getGameMode() != org.bukkit.GameMode.SURVIVAL)
      throw new IllegalStateException("health case requires a vulnerable living survival member");
    var currentWorld = player().getWorld().getUID();
    if (world.isPresent() && world.filter(currentWorld::equals).isEmpty())
      throw new IllegalStateException("health case world changed");
    world = Optional.of(currentWorld);
    return current;
  }

  private void observe() {
    if (!List.of("bound", "observing", "refused").contains(state)) return;
    if (state.equals("bound") && current().phase() != MatchState.Phase.LIVE) return;
    try {
      if (++observedTicks > WIRE.maximumTicks())
        throw new IllegalStateException("health proof tick bound exceeded");
      snapshot();
      if (resistanceSeen && player().getPotionEffect(PotionEffectType.RESISTANCE) == null) {
        resistanceSeen = false;
        setup(
            "effect-expired", Map.of("effect", "resistance", "source", "actual-body-observation"));
      }
    } catch (IllegalArgumentException | IllegalStateException failure) {
      setup("failure", Map.of("message", failure.getMessage()));
      state = "failed";
      clock.ifPresent(BukkitTask::cancel);
    }
  }

  private CombatantView captured(MatchState current) {
    return capture
        .orElseThrow()
        .capture(tick(), current)
        .require(ids.combatant(subject.orElseThrow()));
  }

  private HealthProtocol.Sample snapshot() {
    var current = live();
    var self = captured(current);
    var player = player();
    var sample =
        new HealthProtocol.Sample(
            ++sequence,
            tick(),
            current.matchId(),
            subject.orElseThrow(),
            world.orElseThrow(),
            scenario.orElseThrow().kit(),
            self.alive(),
            self.health(),
            self.absorption(),
            self.traversal().maxHealth(),
            self.lastHurtTick(),
            point(self.pos()),
            point(self.vel()),
            self.onGround(),
            player.getFallDistance(),
            player.getNoDamageTicks(),
            self.sprinting(),
            player.isInWater(),
            self.traversal());
    samples.add(sample);
    return sample;
  }

  private void place() {
    if (!List.of("bound", "observing").contains(state) || !before.isEmpty() || pendingFalls != 0)
      throw new IllegalStateException("health placement requires an idle bound native trial");
    live();
    if (++placements > scenario.orElseThrow().maximumDrops() + 1)
      throw new IllegalStateException("health case exceeded its original drop bound");
    if (course.isEmpty()) prepareCourse();
    var player = player();
    if (!player.teleport(course.orElseThrow().start()))
      throw new IllegalStateException("native course teleport refused");
    player.setVelocity(new org.bukkit.util.Vector());
    player.setFallDistance(0);
    setup(
        "place",
        Map.of(
            "attempt",
            Integer.toString(placements),
            "velocityReset",
            "true",
            "fallDistanceReset",
            "true",
            "directHealthChange",
            "false"));
    var source = snapshot();
    var self = captured(live());
    var destination = course.orElseThrow().landing();
    var arrival = tick() + (long) Math.ceil(TraversalCosts.drop(8)) + 2;
    var damage = FallRisk.damage(destination, self, arrival);
    var prediction =
        new HealthProtocol.Prediction(
            ++sequence,
            tick(),
            source.sequence(),
            arrival,
            damage,
            self.effectiveHealth(),
            damage <= self.effectiveHealth() - 1,
            !self.traversal().maySprint(),
            point(destination.pos()));
    predictions.add(prediction);
    state = prediction.affordable() ? "observing" : "refused";
  }

  private void prepareCourse() {
    var definition =
        ConfigFiles.load(
                plugin
                    .getDataFolder()
                    .toPath()
                    .getParent()
                    .resolve("TheStorm/rwf/maps/training-yard/map.yml"),
                MapFile.class)
            .toDefinition();
    course =
        Optional.of(
            new HealthCourse(
                player().getWorld(),
                plugin,
                definition.border(),
                scenario.orElseThrow().landing().equals("water")));
    setup("course", course.orElseThrow().evidence());
    if (scenario.orElseThrow().mode().equals("protection-expiry")) {
      if (!player().addPotionEffect(new PotionEffect(PotionEffectType.RESISTANCE, 80, 0)))
        throw new IllegalStateException("controlled resistance setup refused");
      resistanceSeen = true;
      setup(
          "effect-add",
          Map.of(
              "effect",
              "resistance",
              "amplifier",
              "0",
              "durationTicks",
              "80",
              "source",
              "explicit-controlled-diagnostic-setup"));
    }
  }

  private boolean watches(EntityDamageEvent event) {
    return state.equals("observing")
        && !(event instanceof EntityDamageByEntityEvent)
        && event.getCause() == EntityDamageEvent.DamageCause.FALL
        && subject.filter(event.getEntity().getUniqueId()::equals).isPresent();
  }

  @EventHandler(priority = EventPriority.LOWEST)
  public void beforeFall(EntityDamageEvent event) {
    if (watches(event)) before.put(event, snapshot());
  }

  @EventHandler(priority = EventPriority.MONITOR)
  public void afterFall(EntityDamageEvent event) {
    var source = before.remove(event);
    if (source == null) return;
    var pending =
        new HealthProtocol.Fall(
            0,
            tick(),
            0,
            predictions.getLast().sequence(),
            event.isCancelled(),
            event.getFinalDamage(),
            source.health(),
            0,
            source.absorption(),
            0,
            source.fallDistance(),
            source.noDamageTicks(),
            0,
            -1);
    pendingFalls++;
    // Vanilla applies environmental damage after MONITOR returns. Never infer health from the
    // event.
    plugin.getServer().getScheduler().runTask(plugin, () -> completeFall(pending));
  }

  private void completeFall(HealthProtocol.Fall pending) {
    try {
      var after = snapshot();
      falls.add(
          new HealthProtocol.Fall(
              ++sequence,
              pending.eventTick(),
              tick(),
              pending.predictionSequence(),
              pending.cancelled(),
              pending.damage(),
              pending.before(),
              after.health(),
              pending.beforeAbsorption(),
              after.absorption(),
              pending.fallDistance(),
              pending.noDamageTicks(),
              after.health(),
              after.lastHurtTick()));
    } catch (IllegalArgumentException | IllegalStateException failure) {
      setup("failure", Map.of("message", failure.toString()));
      state = "failed";
      clock.ifPresent(BukkitTask::cancel);
    } finally {
      pendingFalls--;
    }
  }

  private void setup(String kind, Map<String, String> details) {
    setups.add(new HealthProtocol.Setup(++sequence, tick(), kind, details));
  }

  private HealthProtocol.Status status() {
    return new HealthProtocol.Status(
        WIRE.version(),
        WIRE.kind(),
        false,
        scenario.map(HealthProtocol.Scenario::id).orElse("none"),
        state,
        match.map(UUID::toString).orElse(""),
        subject.map(UUID::toString).orElse(""),
        world.map(UUID::toString).orElse(""),
        List.copyOf(samples),
        List.copyOf(falls),
        List.copyOf(setups),
        List.copyOf(predictions));
  }

  private static List<Double> point(com.shepherdjerred.thestorm.rwfbots.domain.geom.Vec3 value) {
    return List.of(value.x(), value.y(), value.z());
  }

  private void finish() {
    if (!List.of("observing", "refused").contains(state) || pendingFalls != 0)
      throw new IllegalStateException("no live health trial to close");
    course.orElseThrow().release(player());
    setup(
        "course-release",
        Map.of(
            "supportedOriginalCell",
            "20.5,65,6.5",
            "velocityReset",
            "true",
            "fallDistanceReset",
            "true",
            "directHealthChange",
            "false"));
    snapshot();
    if (!state.equals("refused")) state = "closed";
    clock.ifPresent(BukkitTask::cancel);
    course.ifPresent(HealthCourse::close);
    course = Optional.empty();
  }

  @Override
  public void close() {
    clock.ifPresent(BukkitTask::cancel);
    course.ifPresent(HealthCourse::close);
    HandlerList.unregisterAll(this);
  }
}
