package com.shepherdjerred.thestorm.e2e.maps;

import com.shepherdjerred.thestorm.TheStormPlugin;
import com.shepherdjerred.thestorm.rwf.app.MatchView;
import com.shepherdjerred.thestorm.rwf.app.view.MatchState;
import io.papermc.paper.command.brigadier.BasicCommand;
import io.papermc.paper.command.brigadier.CommandSourceStack;
import io.papermc.paper.plugin.lifecycle.event.types.LifecycleEvents;
import java.io.IOException;
import java.util.Arrays;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.stream.Collectors;
import net.kyori.adventure.text.Component;
import org.bukkit.command.RemoteConsoleCommandSender;
import org.bukkit.plugin.java.JavaPlugin;
import tools.jackson.databind.DeserializationFeature;
import tools.jackson.databind.json.JsonMapper;

/** Passively binds a live capacity roster to its actual frozen host band and installed levers. */
public final class CapacityBehaviorFixtures implements BasicCommand {
  private static final JsonMapper JSON =
      JsonMapper.builder()
          .enable(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES)
          .enable(DeserializationFeature.FAIL_ON_NULL_FOR_PRIMITIVES)
          .enable(DeserializationFeature.FAIL_ON_MISSING_CREATOR_PROPERTIES)
          .build();
  private static final Contract WIRE = contract();
  private final JavaPlugin plugin;

  private record Contract(int version, String kind, Map<String, List<String>> records) {}

  private record Capture(
      int version,
      String kind,
      int serverTick,
      UUID match,
      String phase,
      String map,
      String experience,
      String experienceFingerprint,
      AuthoredCombatSettings.Host host,
      List<UUID> humans,
      List<UUID> bots,
      List<AuthoredCombatSettings.Profile> profiles) {}

  public CapacityBehaviorFixtures(JavaPlugin plugin) {
    this.plugin = plugin;
  }

  public void register() {
    plugin
        .getLifecycleManager()
        .registerEventHandler(
            LifecycleEvents.COMMANDS,
            event -> event.registrar().register("rwfcapacitybehavior", this));
  }

  @Override
  public void execute(CommandSourceStack source, String[] args) {
    if (!(source.getSender() instanceof RemoteConsoleCommandSender))
      throw new IllegalStateException("capacity behavior requires the private RCON console");
    if (args.length != 1)
      throw new IllegalArgumentException("expected the original live match UUID");
    var found = plugin.getServer().getPluginManager().getPlugin("TheStorm");
    if (!(found instanceof TheStormPlugin storm))
      throw new IllegalStateException("TheStorm missing");
    var view = storm.service(MatchView.class);
    var current = view.current().map(MatchState::of).orElseThrow();
    if (!current.matchId().equals(UUID.fromString(args[0]))
        || current.phase() != MatchState.Phase.LIVE)
      throw new IllegalStateException("capacity behavior requires the original live match");
    var experience = view.experience(current.matchId()).orElseThrow();
    var humans =
        current.combatants().stream().filter(f -> !f.bot()).map(MatchState.Fighter::uuid).toList();
    var bots =
        current.combatants().stream()
            .filter(MatchState.Fighter::bot)
            .map(MatchState.Fighter::uuid)
            .toList();
    var capture =
        new Capture(
            WIRE.version(),
            WIRE.kind(),
            plugin.getServer().getCurrentTick(),
            current.matchId(),
            current.phase().name(),
            current.mapId().orElseThrow(),
            experience.settings().canonical(experience.seed()),
            experience.settings().fingerprint(experience.seed()),
            AuthoredCombatSettings.host(storm),
            humans,
            bots,
            AuthoredCombatSettings.profiles(storm));
    source.getSender().sendMessage(Component.text(JSON.writeValueAsString(capture)));
  }

  private static Contract contract() {
    var types =
        Map.of(
            "Capture", Capture.class,
            "Host", AuthoredCombatSettings.Host.class,
            "Profile", AuthoredCombatSettings.Profile.class,
            "Levers", com.shepherdjerred.thestorm.rwfbots.domain.difficulty.Levers.class,
            "Style", com.shepherdjerred.thestorm.rwfbots.domain.personality.Style.class);
    var records =
        types.entrySet().stream()
            .collect(
                Collectors.toUnmodifiableMap(
                    Map.Entry::getKey,
                    entry ->
                        Arrays.stream(entry.getValue().getRecordComponents())
                            .map(field -> field.getName())
                            .toList()));
    var expected = new Contract(1, "rwf-capacity-behavior", records);
    try (var stream =
        CapacityBehaviorFixtures.class.getResourceAsStream("/rwf-capacity-behavior.json")) {
      if (stream == null || !expected.equals(JSON.readValue(stream, Contract.class)))
        throw new IllegalStateException("capacity behavior wire differs from actual records");
      return expected;
    } catch (IOException failure) {
      throw new IllegalStateException("capacity behavior wire unreadable", failure);
    }
  }
}
