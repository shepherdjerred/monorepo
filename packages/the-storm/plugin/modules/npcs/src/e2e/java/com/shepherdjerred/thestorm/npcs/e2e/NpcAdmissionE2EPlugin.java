package com.shepherdjerred.thestorm.npcs.e2e;

import com.shepherdjerred.thestorm.core.config.StrictYaml;
import com.shepherdjerred.thestorm.core.result.Result;
import com.shepherdjerred.thestorm.npcs.adapter.paper.CitizensBodies;
import com.shepherdjerred.thestorm.npcs.adapter.paper.NpcKeys;
import com.shepherdjerred.thestorm.npcs.domain.config.NpcsConfig;
import com.shepherdjerred.thestorm.npcs.domain.geo.Rotation;
import com.shepherdjerred.thestorm.npcs.domain.geo.Spot;
import com.shepherdjerred.thestorm.npcs.domain.geo.Vec3;
import com.shepherdjerred.thestorm.npcs.domain.npc.NpcDefinition;
import com.shepherdjerred.thestorm.npcs.domain.npc.NpcPose;
import com.shepherdjerred.thestorm.npcs.domain.npc.Skin;
import java.io.IOException;
import java.nio.file.Files;
import java.util.Objects;
import java.util.Optional;
import java.util.Set;
import net.citizensnpcs.api.CitizensAPI;
import org.bukkit.Location;
import org.bukkit.entity.EntityType;
import org.bukkit.plugin.java.JavaPlugin;

/** Reuses an already spawned registry body at its old home, as on a saved server restart. */
public final class NpcAdmissionE2EPlugin extends JavaPlugin {
  @Override
  public void onEnable() {
    var storm = Objects.requireNonNull(getServer().getPluginManager().getPlugin("TheStorm"));
    try {
      var yaml = Files.readString(storm.getDataFolder().toPath().resolve("npcs.yml"));
      var parsed = StrictYaml.parse("npcs.yml", yaml, NpcsConfig.class);
      if (!(parsed instanceof Result.Ok<NpcsConfig, ?> ok))
        throw new IllegalStateException("NPC fixture configuration failed: " + parsed);
      var bodies = new CitizensBodies(storm, NpcKeys.of(storm), ok.value());
      bodies.start(() -> {});
      verify(bodies, false);
      verify(bodies, true);
      getComponentLogger().info("NPC_ADMISSION_PAPER_PASS");
    } catch (IOException failure) {
      throw new IllegalStateException("Could not read native NPC fixture configuration", failure);
    }
  }

  private void verify(CitizensBodies bodies, boolean stamped) {
    var world = Objects.requireNonNull(getServer().getWorld("world"));
    var id = "fixture-admission-" + stamped;
    var home = new Spot(world.getKey().asString(), new Vec3(140.5, 68, -94.5), new Rotation(90, 0));
    var definition =
        new NpcDefinition(
            id,
            "Admission fixture",
            "Reused saved body",
            new Skin.Default(),
            home,
            NpcPose.STANDING,
            Set.of(),
            Optional.empty(),
            Optional.empty(),
            Optional.empty());
    var npc = CitizensAPI.getNPCRegistry().createNPC(EntityType.PLAYER, definition.name());
    try {
      npc.data().setPersistent("thestorm-scripted-id", id);
      if (stamped) npc.data().setPersistent("thestorm-home", home.toString());
      if (!npc.spawn(new Location(world, 132.5, 68, -94.5)))
        throw new IllegalStateException("Could not seed the saved NPC body");
      var original = Objects.requireNonNull(npc.getEntity()).getUniqueId();
      var entity = bodies.spawn(definition);
      if (!original.equals(entity.getUniqueId())
          || entity.getLocation().distanceSquared(new Location(world, 140.5, 68, -94.5)) > 0.0001)
        throw new IllegalStateException("Reused NPC did not move to its authored home");
    } finally {
      npc.destroy();
    }
  }
}
