package com.shepherdjerred.thestorm.npcs.e2e;

import com.shepherdjerred.thestorm.npcs.domain.geo.Rotation;
import com.shepherdjerred.thestorm.npcs.domain.geo.Spot;
import com.shepherdjerred.thestorm.npcs.domain.geo.Vec3;
import com.shepherdjerred.thestorm.npcs.domain.npc.NpcDefinition;
import com.shepherdjerred.thestorm.npcs.domain.npc.NpcPose;
import com.shepherdjerred.thestorm.npcs.domain.npc.Skin;
import java.io.IOException;
import java.nio.file.Files;
import java.util.ArrayList;
import java.util.List;
import java.util.Objects;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import net.citizensnpcs.api.CitizensAPI;
import net.citizensnpcs.api.npc.NPC;
import org.bukkit.Location;
import org.bukkit.entity.EntityType;
import org.bukkit.plugin.java.JavaPlugin;
import org.bukkit.scheduler.BukkitRunnable;

/** Seeds saved bodies before TheStorm enables, then verifies its real reconciliation path. */
public final class NpcAdmissionE2EPlugin extends JavaPlugin {
  private record Expected(NPC npc, UUID body, Location home) {}

  @Override
  public void onEnable() {
    var storm = Objects.requireNonNull(getServer().getPluginManager().getPlugin("TheStorm"));
    var expected = new ArrayList<Expected>();
    var yaml = new StringBuilder("places: {}\nskins: {}\nschedules: {}\ndialogues: {}\nnpcs:\n");
    for (var stamped : List.of(false, true)) {
      var definition = definition(stamped);
      var home = definition.home();
      yaml.append(
          """
            %s:
              name: Admission fixture
              description: Reused saved body
              skin: none
              home: { world: "%s", x: %s, y: 68.0, z: -94.5, yaw: 90.0, pitch: 0.0 }
              pose: standing
              roles: []
              schedule: none
              dialogue: none
              trainer: none
          """
              .formatted(definition.id(), home.world(), home.position().x()));
      expected.add(seed(definition, stamped));
    }
    try {
      var directory = Files.createDirectories(storm.getDataFolder().toPath().resolve("npcs"));
      Files.writeString(directory.resolve("admission-fixture.yml"), yaml.toString());
    } catch (IOException failure) {
      throw new IllegalStateException("Could not seed native NPC admission content", failure);
    }
    new BukkitRunnable() {
      private int ticks;

      @Override
      public void run() {
        if (expected.stream().allMatch(NpcAdmissionE2EPlugin::admitted)) {
          getComponentLogger().info("NPC_ADMISSION_PAPER_PASS");
          cancel();
        } else if (++ticks >= 1000) {
          cancel();
          throw new IllegalStateException("Native reconciliation did not admit saved NPC bodies");
        }
      }
    }.runTaskTimer(this, 1, 1);
  }

  private NpcDefinition definition(boolean stamped) {
    var world = Objects.requireNonNull(getServer().getWorld("world"));
    var x = stamped ? 142.5 : 140.5;
    return new NpcDefinition(
        "fixture-admission-" + stamped,
        "Admission fixture",
        "Reused saved body",
        new Skin.Default(),
        new Spot(world.getKey().asString(), new Vec3(x, 68, -94.5), new Rotation(90, 0)),
        NpcPose.STANDING,
        Set.of(),
        Optional.empty(),
        Optional.empty(),
        Optional.empty());
  }

  private Expected seed(NpcDefinition definition, boolean stamped) {
    var world = Objects.requireNonNull(getServer().getWorld("world"));
    var npc = CitizensAPI.getNPCRegistry().createNPC(EntityType.PLAYER, definition.name());
    npc.data().setPersistent("thestorm-scripted-id", definition.id());
    npc.data().setPersistent("thestorm-fingerprint", stamped ? definition.fingerprint() : "old");
    if (stamped) npc.data().setPersistent("thestorm-home", definition.home().toString());
    if (!npc.spawn(new Location(world, 132.5, 68, -94.5)))
      throw new IllegalStateException("Could not seed the saved NPC body");
    var body = Objects.requireNonNull(npc.getEntity()).getUniqueId();
    return new Expected(
        npc, body, new Location(world, definition.home().position().x(), 68, -94.5));
  }

  private static boolean admitted(Expected expected) {
    var body = expected.npc().getEntity();
    return body != null
        && expected.body().equals(body.getUniqueId())
        && body.getLocation().distanceSquared(expected.home()) < 0.0001;
  }
}
