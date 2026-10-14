package com.shepherdjerred.thestorm.e2e.maps;

import com.shepherdjerred.thestorm.TheStormPlugin;
import com.shepherdjerred.thestorm.rwf.app.ExperienceSettings;
import com.shepherdjerred.thestorm.rwf.app.MatchView;
import com.shepherdjerred.thestorm.rwf.app.view.MatchState;
import io.papermc.paper.command.brigadier.BasicCommand;
import io.papermc.paper.command.brigadier.CommandSourceStack;
import io.papermc.paper.plugin.lifecycle.event.types.LifecycleEvents;
import java.util.ArrayList;
import java.util.IdentityHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import net.kyori.adventure.text.Component;
import org.bukkit.Difficulty;
import org.bukkit.World;
import org.bukkit.command.ConsoleCommandSender;
import org.bukkit.command.RemoteConsoleCommandSender;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.entity.EntityDamageByEntityEvent;
import org.bukkit.event.entity.EntityDamageEvent;
import org.bukkit.event.entity.PlayerDeathEvent;
import org.bukkit.plugin.java.JavaPlugin;

/** Passive ordinary NPC melee receipts. Only the disposable world's difficulty is controlled. */
public final class AuthoredCombatFixtures implements BasicCommand, Listener, AutoCloseable {
  private static final tools.jackson.databind.json.JsonMapper JSON =
      tools.jackson.databind.json.JsonMapper.builder().build();
  private static final AuthoredCombatProtocol WIRE =
      AuthoredCombatProtocol.load(
          Map.ofEntries(
              Map.entry("Actor", Actor.class),
              Map.entry("Frame", Frame.class),
              Map.entry("Hit", Hit.class),
              Map.entry("Environment", Environment.class),
              Map.entry("Probe", Probe.class),
              Map.entry("Capture", Capture.class),
              Map.entry("Host", AuthoredCombatSettings.Host.class),
              Map.entry("Profile", AuthoredCombatSettings.Profile.class),
              Map.entry("Effective", AuthoredCombatSettings.Effective.class),
              Map.entry(
                  "Levers", com.shepherdjerred.thestorm.rwfbots.domain.difficulty.Levers.class),
              Map.entry(
                  "Style", com.shepherdjerred.thestorm.rwfbots.domain.personality.Style.class)));
  private final JavaPlugin plugin;
  private final String mapsWorld;
  private final List<Frame> frames = new ArrayList<>();
  private final List<Hit> hits = new ArrayList<>();
  private final IdentityHashMap<EntityDamageByEntityEvent, Frame> before = new IdentityHashMap<>();
  private Optional<Binding> binding = Optional.empty();
  private String state = "idle";
  private String message = "";
  private long sequence;
  private int pending;
  private int dropped;

  private record Binding(
      UUID match,
      UUID human,
      UUID bot,
      World world,
      Difficulty originalDifficulty,
      int startedTick,
      String experience,
      AuthoredCombatSettings.Effective effective) {}

  private record Actor(
      UUID body,
      UUID world,
      String kit,
      String team,
      boolean alive,
      boolean physicallyAlive,
      boolean valid,
      boolean online,
      String mode,
      boolean invulnerable,
      double health,
      double absorption,
      int noDamageTicks,
      List<Double> position,
      int foodLevel,
      float saturation) {}

  private record Frame(
      long sequence,
      int serverTick,
      UUID match,
      UUID world,
      String phase,
      String difficulty,
      Actor human,
      Actor bot,
      AuthoredCombatSettings.Effective effective) {}

  private record Hit(
      long sequence, String cause, boolean cancelled, Frame before, Frame monitor, Frame after) {}

  private record Environment(
      String originalDifficulty, String currentDifficulty, boolean restored) {}

  private record Probe(boolean ready, String message, Frame frame) {}

  private record Capture(
      int version,
      String kind,
      boolean humanDemonstration,
      boolean authoredBotControl,
      String state,
      String message,
      UUID match,
      UUID world,
      UUID human,
      UUID bot,
      String experience,
      AuthoredCombatSettings.Effective effective,
      int startedTick,
      int sampledTick,
      int dropped,
      int pending,
      Environment environment,
      List<Frame> frames,
      List<Hit> hits) {}

  public AuthoredCombatFixtures(JavaPlugin plugin) {
    this.plugin = plugin;
    mapsWorld =
        com.shepherdjerred.thestorm.core.config.ConfigFiles.load(
                plugin.getDataFolder().getParentFile().toPath().resolve("TheStorm/rwf.yml"),
                com.shepherdjerred.thestorm.rwf.adapter.content.RwfConfig.class)
            .worlds()
            .maps();
  }

  public void register() {
    plugin
        .getLifecycleManager()
        .registerEventHandler(
            LifecycleEvents.COMMANDS,
            event -> event.registrar().register("storm-fixture-authored-combat", this));
    plugin.getServer().getPluginManager().registerEvents(this, plugin);
  }

  @Override
  public void execute(CommandSourceStack source, String[] args) {
    if (!(source.getSender() instanceof ConsoleCommandSender
        || source.getSender() instanceof RemoteConsoleCommandSender)) {
      source.getSender().sendMessage(Component.text("authored combat requires the test console"));
      return;
    }
    try {
      Object response;
      if (args.length == 1 && args[0].equals("contract")) response = WIRE;
      else if (args.length == 1 && args[0].equals("settings"))
        response = AuthoredCombatSettings.host(storm());
      else if (args.length == 3 && args[0].equals("probe"))
        response = probe(UUID.fromString(args[1]), UUID.fromString(args[2]));
      else {
        command(args);
        response = capture();
      }
      source.getSender().sendMessage(Component.text(JSON.writeValueAsString(response)));
    } catch (IllegalArgumentException | IllegalStateException failure) {
      source
          .getSender()
          .sendMessage(
              Component.text(JSON.writeValueAsString(Map.of("error", failure.getMessage()))));
    }
  }

  private void command(String[] args) {
    if (args.length == 3 && args[0].equals("arm")) {
      arm(UUID.fromString(args[1]), UUID.fromString(args[2]));
    } else if (args.length == 1 && args[0].equals("sample")) {
      if (state.equals("observing")) observe();
    } else if (args.length == 1 && args[0].equals("finish")) {
      finish();
    } else
      throw new IllegalArgumentException(
          "use contract, probe/arm <match> <human>, sample or finish");
  }

  private void finish() {
    if (!state.equals("observing") || pending != 0 || !before.isEmpty())
      throw new IllegalStateException("finish requires the active observer with no pending hit");
    observe();
    if (state.equals("observing")) {
      state = "closed";
      restore();
    }
  }

  private TheStormPlugin storm() {
    var found = plugin.getServer().getPluginManager().getPlugin("TheStorm");
    if (!(found instanceof TheStormPlugin storm))
      throw new IllegalStateException("TheStorm missing");
    return storm;
  }

  private MatchView matches() {
    return storm().service(MatchView.class);
  }

  private MatchState current() {
    return matches()
        .current()
        .map(MatchState::of)
        .orElseThrow(() -> new IllegalStateException("ordinary match missing"));
  }

  private Probe probe(UUID match, UUID human) {
    var current = current();
    var humans = current.combatants().stream().filter(fighter -> !fighter.bot()).toList();
    var bots = current.combatants().stream().filter(MatchState.Fighter::bot).toList();
    if (humans.size() != 1 || !humans.getFirst().uuid().equals(human) || bots.size() != 1)
      throw new IllegalStateException("original two-participant roster differs: " + current);
    var raw = rawFrame(current, human, bots.getFirst().uuid());
    var world = plugin.getServer().getWorld(mapsWorld);
    if (world == null)
      throw new IllegalStateException("configured match world missing: " + mapsWorld);
    var reason = identityProblem(raw, match, world.getUID());
    if (reason.isEmpty() && (raw.human().invulnerable() || raw.human().noDamageTicks() > 0))
      reason = "original human native spawn protection has not expired";
    return new Probe(reason.isEmpty(), reason, raw);
  }

  private void arm(UUID match, UUID human) {
    if (binding.isPresent()) throw new IllegalStateException("observer already armed");
    var ready = probe(match, human);
    if (!ready.ready()) throw new IllegalStateException("native bodies not ready: " + ready);
    var player = player(human);
    var experience = matches().experience(match).orElseThrow();
    var settings = experience.settings();
    if (settings.difficulty() != ExperienceSettings.Difficulty.HARD
        || settings.style() != ExperienceSettings.Style.VARIED
        || settings.variety() != ExperienceSettings.Variety.HIGH
        || !settings.kits().equals(Set.of("trooper")))
      throw new IllegalStateException(
          "requires frozen hard/varied/high Trooper baseline: " + settings);
    AuthoredCombatSettings.requireHard(ready.frame().effective(), human);
    binding =
        Optional.of(
            new Binding(
                match,
                human,
                ready.frame().bot().body(),
                player.getWorld(),
                player.getWorld().getDifficulty(),
                plugin.getServer().getCurrentTick(),
                settings.canonical(experience.seed()),
                ready.frame().effective()));
    player.getWorld().setDifficulty(Difficulty.HARD);
    state = "observing";
    observe();
  }

  private Player player(UUID id) {
    var entity = plugin.getServer().getEntity(id);
    if (!(entity instanceof Player player))
      throw new IllegalStateException("original player body missing: " + id);
    return player;
  }

  private Frame recordFrame() {
    var active = binding.orElseThrow();
    var current = current();
    if (frames.size() >= WIRE.maximumRows())
      throw new IllegalStateException("capture row bound exceeded");
    var raw = rawFrame(current, active.human(), active.bot());
    frames.add(raw);
    var reason = identityProblem(raw, active.match(), active.world().getUID());
    if (!reason.isEmpty()) throw new IllegalStateException(reason + ": " + raw);
    if (!raw.effective().equals(active.effective()))
      throw new IllegalStateException("effective host settings or bot profile changed: " + raw);
    if (current.combatants().size() != 2
        || fighter(current, active.human()).bot()
        || !fighter(current, active.bot()).bot()
        || raw.serverTick() - active.startedTick() > WIRE.maximumTicks())
      throw new IllegalStateException("original live roster or bounded interval ended: " + current);
    return raw;
  }

  private static String identityProblem(Frame frame, UUID match, UUID world) {
    var human = frame.human();
    var bot = frame.bot();
    if (!frame.match().equals(match)
        || !frame.phase().equals("LIVE")
        || !human.world().equals(world)
        || !bot.world().equals(world)
        || human.team().equals(bot.team())
        || !human.kit().equals("trooper")
        || !bot.kit().equals("trooper")
        || !human.mode().equals("SURVIVAL"))
      return "original opposing Trooper identities/world/SURVIVAL mode differ";
    if (!nativeReady(human) || !nativeReady(bot) || !human.online())
      return "original native live bodies are not ready";
    return "";
  }

  private static boolean nativeReady(Actor actor) {
    return actor.alive() && actor.physicallyAlive() && actor.valid();
  }

  private static MatchState.Fighter fighter(MatchState match, UUID body) {
    return match
        .combatant(body)
        .orElseThrow(
            () -> new IllegalStateException("original member missing: " + body + " from " + match));
  }

  private Frame rawFrame(MatchState match, UUID human, UUID bot) {
    var humanBody = actor(fighter(match, human));
    return new Frame(
        sequence++,
        plugin.getServer().getCurrentTick(),
        match.matchId(),
        humanBody.world(),
        match.phase().name(),
        player(human).getWorld().getDifficulty().name(),
        humanBody,
        actor(fighter(match, bot)),
        AuthoredCombatSettings.capture(storm(), bot));
  }

  private Actor actor(MatchState.Fighter fighter) {
    var body = player(fighter.uuid());
    var pos = body.getLocation();
    return new Actor(
        fighter.uuid(),
        body.getWorld().getUID(),
        fighter.kit().orElseThrow(),
        fighter.team().orElseThrow(),
        fighter.alive(),
        !body.isDead(),
        body.isValid(),
        body.isOnline(),
        body.getGameMode().name(),
        body.isInvulnerable(),
        body.getHealth(),
        body.getAbsorptionAmount(),
        body.getNoDamageTicks(),
        List.of(pos.getX(), pos.getY(), pos.getZ()),
        body.getFoodLevel(),
        body.getSaturation());
  }

  private void observe() {
    try {
      recordFrame();
    } catch (IllegalStateException failure) {
      fail(failure.getMessage());
    }
  }

  private Capture capture() {
    var active = binding.orElseThrow(() -> new IllegalStateException("observer not armed"));
    return new Capture(
        WIRE.version(),
        WIRE.kind(),
        false,
        true,
        state,
        message,
        active.match(),
        active.world().getUID(),
        active.human(),
        active.bot(),
        active.experience(),
        active.effective(),
        active.startedTick(),
        plugin.getServer().getCurrentTick(),
        dropped,
        pending + before.size(),
        new Environment(
            active.originalDifficulty().name(),
            active.world().getDifficulty().name(),
            !state.equals("observing")
                && active.world().getDifficulty() == active.originalDifficulty()),
        List.copyOf(frames),
        List.copyOf(hits));
  }

  private boolean originalHit(EntityDamageByEntityEvent event) {
    if (!state.equals("observing")
        || binding.isEmpty()
        || event.getCause() != EntityDamageEvent.DamageCause.ENTITY_ATTACK) return false;
    var active = binding.orElseThrow();
    return event.getEntity().getUniqueId().equals(active.human())
        && event.getDamager() instanceof Player
        && event.getDamager().getUniqueId().equals(active.bot());
  }

  @EventHandler(priority = EventPriority.LOWEST)
  public void beforeDamage(EntityDamageByEntityEvent event) {
    if (!originalHit(event)) return;
    try {
      before.put(event, recordFrame());
    } catch (IllegalStateException failure) {
      fail(failure.getMessage());
    }
  }

  @EventHandler(priority = EventPriority.MONITOR)
  public void afterDamage(EntityDamageByEntityEvent event) {
    var source = before.remove(event);
    if (source == null) return;
    try {
      var monitor = recordFrame();
      if (hits.size() >= WIRE.maximumRows()) {
        dropped++;
        fail("native hit row bound exceeded");
        return;
      }
      var cancelled = event.isCancelled();
      pending++;
      // A zero-delay task can run in the current heartbeat when the NPC attacks from a task.
      plugin
          .getServer()
          .getScheduler()
          .runTaskLater(plugin, () -> complete(source, monitor, cancelled), 1L);
    } catch (IllegalStateException failure) {
      fail(failure.getMessage());
    }
  }

  private void complete(Frame source, Frame monitor, boolean cancelled) {
    pending--;
    if (!state.equals("observing")) return;
    try {
      var after = recordFrame();
      hits.add(new Hit(sequence++, "ENTITY_ATTACK", cancelled, source, monitor, after));
      frames.remove(source);
      frames.remove(monitor);
      frames.remove(after);
    } catch (IllegalStateException failure) {
      fail(failure.getMessage());
    }
  }

  @EventHandler(priority = EventPriority.MONITOR)
  public void death(PlayerDeathEvent event) {
    if (binding.isEmpty() || !state.equals("observing")) return;
    var active = binding.orElseThrow();
    var id = event.getEntity().getUniqueId();
    if (id.equals(active.human()) || id.equals(active.bot())) fail("original life ended");
  }

  private void fail(String reason) {
    state = "failed";
    message = reason;
    restore();
  }

  private void restore() {
    binding.ifPresent(active -> active.world().setDifficulty(active.originalDifficulty()));
  }

  @Override
  public void close() {
    if (state.equals("observing")) fail("observer closed before terminal proof");
    else restore();
  }
}
