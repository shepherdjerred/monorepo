package com.shepherdjerred.thestorm.quests.adapter.paper;

import static java.util.stream.Collectors.toUnmodifiableSet;

import com.shepherdjerred.thestorm.npcs.app.NpcDirectory;
import com.shepherdjerred.thestorm.npcs.app.NpcRef;
import com.shepherdjerred.thestorm.quests.domain.content.ContentRegistry;
import com.shepherdjerred.thestorm.tracks.app.Track;
import io.papermc.paper.registry.RegistryAccess;
import io.papermc.paper.registry.RegistryKey;
import java.util.Arrays;
import java.util.Set;
import org.bukkit.Keyed;
import org.bukkit.Material;
import org.bukkit.NamespacedKey;
import org.bukkit.Server;
import org.bukkit.entity.EntityType;

/** What exists on the running server, for checking quest content. */
public final class Registries {

  private Registries() {}

  /** The live registry: loaded worlds, NPCs, and the server's materials and entity types. */
  public static ContentRegistry of(Server server, NpcDirectory npcs) {
    return new ContentRegistry(
        npcs.all().stream().map(NpcRef::id).collect(toUnmodifiableSet()),
        materials(true),
        materials(false),
        entities(),
        server.getWorlds().stream()
            .map(world -> world.getKey().asString())
            .collect(toUnmodifiableSet()),
        tracks(),
        enchantments(),
        potions());
  }

  /** Item ({@code items}) or block material names, without legacy ones. */
  public static Set<String> materials(boolean items) {
    return Arrays.stream(Material.values())
        .filter(material -> !material.name().startsWith("LEGACY_"))
        .filter(material -> items ? material.isItem() : material.isBlock())
        .map(Material::name)
        .collect(toUnmodifiableSet());
  }

  /** Living entity types that can be spawned. */
  public static Set<String> entities() {
    return Arrays.stream(EntityType.values())
        .filter(type -> type.isAlive() && type.isSpawnable())
        .map(EntityType::name)
        .collect(toUnmodifiableSet());
  }

  /** Track ids. */
  public static Set<String> tracks() {
    return Arrays.stream(Track.values()).map(Track::id).collect(toUnmodifiableSet());
  }

  /** Enchantment keys, without the namespace. */
  public static Set<String> enchantments() {
    return keys(RegistryKey.ENCHANTMENT);
  }

  /** Potion type keys, without the namespace. */
  public static Set<String> potions() {
    return keys(RegistryKey.POTION);
  }

  private static <T extends Keyed> Set<String> keys(RegistryKey<T> key) {
    var registry = RegistryAccess.registryAccess().getRegistry(key);
    // Streaming the values (not keyStream) makes lazily loaded registries load first.
    return registry.stream()
        .map(registry::getKeyOrThrow)
        .map(NamespacedKey::getKey)
        .collect(toUnmodifiableSet());
  }
}
