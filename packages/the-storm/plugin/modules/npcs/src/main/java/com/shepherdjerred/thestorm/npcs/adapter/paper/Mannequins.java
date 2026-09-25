package com.shepherdjerred.thestorm.npcs.adapter.paper;

import com.destroystokyo.paper.profile.ProfileProperty;
import com.shepherdjerred.thestorm.core.text.HouseStyle;
import com.shepherdjerred.thestorm.npcs.domain.geo.Rotation;
import com.shepherdjerred.thestorm.npcs.domain.geo.Spot;
import com.shepherdjerred.thestorm.npcs.domain.geo.Vec3;
import com.shepherdjerred.thestorm.npcs.domain.npc.NpcDefinition;
import com.shepherdjerred.thestorm.npcs.domain.npc.NpcPose;
import com.shepherdjerred.thestorm.npcs.domain.npc.Skin;
import com.shepherdjerred.thestorm.npcs.domain.reconcile.Reconciler.Spawned;
import io.papermc.paper.datacomponent.item.ResolvableProfile;
import java.nio.charset.StandardCharsets;
import java.util.Optional;
import java.util.UUID;
import net.kyori.adventure.key.Key;
import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.format.NamedTextColor;
import org.bukkit.Location;
import org.bukkit.NamespacedKey;
import org.bukkit.Server;
import org.bukkit.World;
import org.bukkit.entity.Entity;
import org.bukkit.entity.Mannequin;
import org.bukkit.entity.Pose;
import org.bukkit.persistence.PersistentDataType;
import org.bukkit.profile.PlayerTextures;

/** Creating, dressing and recognizing NPC Mannequins. Main thread. */
final class Mannequins {

  /** The name signed skins are given; the client only needs the textures. */
  private static final String PROFILE_NAME = "TheStormNpc";

  private final Server server;
  private final NpcKeys keys;

  Mannequins(Server server, NpcKeys keys) {
    this.server = server;
    this.keys = keys;
  }

  /** The world for a content world key; content validation guarantees it is loaded. */
  World world(String key) {
    var world = server.getWorld(requireKey(key));
    if (world == null) {
      throw new IllegalStateException("world " + key + " is not loaded");
    }
    return world;
  }

  Location location(Spot spot) {
    return location(world(spot.world()), spot.position(), spot.rotation());
  }

  static Location location(World world, Vec3 position, Rotation facing) {
    return new Location(
        world, position.x(), position.y(), position.z(), facing.yaw(), facing.pitch());
  }

  static Vec3 position(Location location) {
    return new Vec3(location.getX(), location.getY(), location.getZ());
  }

  static Rotation facing(Location location) {
    return new Rotation(location.getYaw(), Math.clamp(location.getPitch(), -90, 90));
  }

  /** Spawns {@code npc} at its home. */
  Mannequin spawn(NpcDefinition npc) {
    return world(npc.home().world())
        .spawn(location(npc.home()), Mannequin.class, mannequin -> dress(mannequin, npc));
  }

  /** Applies everything the definition says about the entity itself. */
  void dress(Mannequin mannequin, NpcDefinition npc) {
    mannequin.customName(Component.text(npc.name(), HouseStyle.BRAND));
    mannequin.setCustomNameVisible(true);
    mannequin.setDescription(
        npc.description().isBlank()
            ? Component.empty()
            : Component.text(npc.description(), NamedTextColor.GRAY));
    mannequin.setImmovable(true);
    mannequin.setInvulnerable(true);
    mannequin.setSilent(true);
    mannequin.setPersistent(true);
    pose(mannequin, npc.pose());
    skin(mannequin, npc.skin());
    var data = mannequin.getPersistentDataContainer();
    data.set(keys.npc(), PersistentDataType.STRING, npc.id());
    data.set(keys.fingerprint(), PersistentDataType.STRING, npc.fingerprint());
  }

  static void pose(Mannequin mannequin, NpcPose pose) {
    var wanted = Pose.valueOf(pose.name());
    if (mannequin.getPose() != wanted) {
      mannequin.setPose(wanted, true);
    }
  }

  /** Sets the profile only when the skin changed, since a new profile is sent to every viewer. */
  private void skin(Mannequin mannequin, Skin skin) {
    var data = mannequin.getPersistentDataContainer();
    var worn = data.get(keys.skin(), PersistentDataType.STRING);
    var wanted = skin.describe();
    // A fresh Mannequin already wears the default skin.
    if (wanted.equals(worn) || (worn == null && skin instanceof Skin.Default)) {
      data.set(keys.skin(), PersistentDataType.STRING, wanted);
      return;
    }
    mannequin.setProfile(profile(skin));
    data.set(keys.skin(), PersistentDataType.STRING, wanted);
  }

  static ResolvableProfile profile(Skin skin) {
    return switch (skin) {
      case Skin.Default() -> Mannequin.defaultProfile();
      case Skin.Vanilla vanilla ->
          ResolvableProfile.resolvableProfile()
              .skinPatch(
                  patch ->
                      patch
                          .body(Key.key(Key.MINECRAFT_NAMESPACE, vanilla.texturePath()))
                          .model(
                              vanilla.model() == Skin.Model.SLIM
                                  ? PlayerTextures.SkinModel.SLIM
                                  : PlayerTextures.SkinModel.CLASSIC))
              .build();
      case Skin.Signed(var id, var value, var signature) ->
          ResolvableProfile.resolvableProfile()
              .name(PROFILE_NAME)
              .uuid(
                  UUID.nameUUIDFromBytes(
                      ("thestorm-npc-skin:" + id).getBytes(StandardCharsets.UTF_8)))
              .addProperty(new ProfileProperty("textures", value, signature))
              .build();
    };
  }

  /** The NPC id and fingerprint {@code entity} carries, if it is one of our Mannequins. */
  Optional<Spawned> read(Entity entity) {
    if (!(entity instanceof Mannequin)) {
      return Optional.empty();
    }
    var data = entity.getPersistentDataContainer();
    var id = data.get(keys.npc(), PersistentDataType.STRING);
    if (id == null) {
      return Optional.empty();
    }
    var fingerprint = data.getOrDefault(keys.fingerprint(), PersistentDataType.STRING, "");
    return Optional.of(new Spawned(entity.getUniqueId(), id, fingerprint));
  }

  static NamespacedKey requireKey(String key) {
    var parsed = NamespacedKey.fromString(key);
    if (parsed == null) {
      throw new IllegalArgumentException("not a namespaced key: " + key);
    }
    return parsed;
  }
}
