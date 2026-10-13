package com.shepherdjerred.thestorm.e2e;

import com.shepherdjerred.thestorm.TheStormPlugin;
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
import java.util.stream.Collectors;
import net.kyori.adventure.text.Component;
import org.bukkit.command.ConsoleCommandSender;
import org.bukkit.command.RemoteConsoleCommandSender;
import org.bukkit.entity.Player;
import org.bukkit.entity.Projectile;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.entity.EntityDamageByEntityEvent;
import org.bukkit.plugin.java.JavaPlugin;
import tools.jackson.databind.json.JsonMapper;

/** Observes ordinary match hits without moving, controlling or damaging any actor. */
final class CapacityCombatFixtures implements BasicCommand, Listener {
  private static final JsonMapper JSON = JsonMapper.builder().build();
  private static final CapacityCombatProtocol WIRE =
      CapacityCombatProtocol.load(Map.of("Capture", Capture.class, "Hit", Hit.class));
  private final JavaPlugin plugin;
  private Optional<Binding> binding = Optional.empty();
  private final IdentityHashMap<EntityDamageByEntityEvent, Before> pending =
      new IdentityHashMap<>();
  private final List<Hit> hits = new ArrayList<>();
  private int dropped;
  private long sequence;

  private record Binding(UUID match, int startedTick, UUID human, Set<UUID> bots) {}

  private record Before(UUID attacker, double health, double absorption) {}

  private record Hit(
      long sequence,
      int serverTick,
      UUID attacker,
      UUID victim,
      String cause,
      boolean cancelled,
      double beforeHealth,
      double beforeAbsorption,
      double afterHealth,
      double afterAbsorption) {}

  private record Capture(
      int schema,
      String kind,
      UUID match,
      int startedTick,
      int sampledTick,
      UUID human,
      List<UUID> bots,
      int dropped,
      int pending,
      List<Hit> hits) {}

  CapacityCombatFixtures(JavaPlugin plugin) {
    this.plugin = plugin;
  }

  void register() {
    plugin
        .getLifecycleManager()
        .registerEventHandler(
            LifecycleEvents.COMMANDS,
            event -> event.registrar().register("rwfcapacitycombat", this));
    plugin.getServer().getPluginManager().registerEvents(this, plugin);
  }

  @Override
  public void execute(CommandSourceStack source, String[] args) {
    if (!(source.getSender() instanceof ConsoleCommandSender
        || source.getSender() instanceof RemoteConsoleCommandSender)) {
      source.getSender().sendMessage(Component.text("capacity combat requires the test console"));
      return;
    }
    try {
      command(args);
      source.getSender().sendMessage(Component.text(JSON.writeValueAsString(sample())));
    } catch (IllegalArgumentException | IllegalStateException failure) {
      source
          .getSender()
          .sendMessage(
              Component.text(JSON.writeValueAsString(Map.of("error", failure.getMessage()))));
    }
  }

  private void command(String[] args) {
    if (args.length == 2 && args[0].equals("arm")) arm(UUID.fromString(args[1]));
    else if (!(args.length == 1 && args[0].equals("sample")))
      throw new IllegalArgumentException("use arm <ordinary-live-match-uuid> or sample");
  }

  private MatchState current() {
    var found = plugin.getServer().getPluginManager().getPlugin("TheStorm");
    if (!(found instanceof TheStormPlugin storm))
      throw new IllegalStateException("TheStorm missing");
    return storm.service(MatchView.class).current().map(MatchState::of).orElseThrow();
  }

  private void arm(UUID match) {
    if (binding.isPresent()) throw new IllegalStateException("observer already armed");
    var state = current();
    var humans = state.combatants().stream().filter(fighter -> !fighter.bot()).toList();
    var bots =
        state.combatants().stream()
            .filter(MatchState.Fighter::bot)
            .map(MatchState.Fighter::uuid)
            .collect(Collectors.toUnmodifiableSet());
    if (!state.matchId().equals(match)
        || state.phase() != MatchState.Phase.LIVE
        || humans.size() != 1
        || bots.isEmpty())
      throw new IllegalStateException(
          "observer requires the original ordinary one-human live match");
    binding =
        Optional.of(
            new Binding(
                match, plugin.getServer().getCurrentTick(), humans.getFirst().uuid(), bots));
  }

  private Capture sample() {
    var active = binding.orElseThrow(() -> new IllegalStateException("observer is not armed"));
    return new Capture(
        WIRE.version(),
        WIRE.kind(),
        active.match(),
        active.startedTick(),
        plugin.getServer().getCurrentTick(),
        active.human(),
        active.bots().stream().sorted().toList(),
        dropped,
        pending.size(),
        List.copyOf(hits));
  }

  private static UUID attacker(EntityDamageByEntityEvent event) {
    if (event.getDamager() instanceof Projectile projectile
        && projectile.getShooter() instanceof Player shooter) return shooter.getUniqueId();
    return event.getDamager().getUniqueId();
  }

  @EventHandler(priority = EventPriority.LOWEST)
  public void beforeDamage(EntityDamageByEntityEvent event) {
    if (binding.isEmpty() || !(event.getEntity() instanceof Player victim)) return;
    var active = binding.orElseThrow();
    var attacker = attacker(event);
    if (!active.human().equals(victim.getUniqueId()) || !active.bots().contains(attacker)) return;
    var state = current();
    if (!active.match().equals(state.matchId()) || state.phase() != MatchState.Phase.LIVE) return;
    pending.put(event, new Before(attacker, victim.getHealth(), victim.getAbsorptionAmount()));
  }

  @EventHandler(priority = EventPriority.MONITOR)
  public void afterDamage(EntityDamageByEntityEvent event) {
    var before = pending.remove(event);
    if (before == null || !(event.getEntity() instanceof Player victim)) return;
    if (hits.size() == WIRE.maximumRows()) {
      dropped++;
      return;
    }
    // The ordinary RWF listener applies custom HP changes and then cancels vanilla damage.
    hits.add(
        new Hit(
            sequence++,
            plugin.getServer().getCurrentTick(),
            before.attacker(),
            victim.getUniqueId(),
            event.getCause().name(),
            event.isCancelled(),
            before.health(),
            before.absorption(),
            victim.getHealth(),
            victim.getAbsorptionAmount()));
  }
}
