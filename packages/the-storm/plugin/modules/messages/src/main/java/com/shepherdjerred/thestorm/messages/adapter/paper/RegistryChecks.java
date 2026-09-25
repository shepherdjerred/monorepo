package com.shepherdjerred.thestorm.messages.adapter.paper;

import com.shepherdjerred.thestorm.messages.domain.DeathCause;
import io.papermc.paper.registry.RegistryAccess;
import io.papermc.paper.registry.RegistryKey;
import java.util.Collection;
import net.kyori.adventure.key.Key;
import org.bukkit.NamespacedKey;

/**
 * Checks the catalog against the running server's registries at enable, so a new damage type or a
 * misspelled mob stops the module instead of surfacing mid-game.
 */
public final class RegistryChecks {

  private RegistryChecks() {}

  /** Fails if the server has a damage type the death catalog does not map. */
  public static void requireEveryDamageTypeMapped() {
    var unmapped =
        RegistryAccess.registryAccess()
            .getRegistry(RegistryKey.DAMAGE_TYPE)
            .keyStream()
            .map(NamespacedKey::asString)
            .filter(key -> DeathCause.fromDamageType(key).isEmpty())
            .sorted()
            .toList();
    if (!unmapped.isEmpty()) {
      throw new IllegalStateException(
          "messages: no death cause for damage types " + unmapped + "; add them to DeathCause");
    }
  }

  /** Fails if any of {@code types} is not a vanilla entity type key. */
  public static void requireEntityTypes(Collection<String> types) {
    var registry = RegistryAccess.registryAccess().getRegistry(RegistryKey.ENTITY_TYPE);
    var unknown =
        types.stream()
            .filter(type -> registry.get(Key.key(Key.MINECRAFT_NAMESPACE, type)) == null)
            .sorted()
            .toList();
    if (!unknown.isEmpty()) {
      throw new IllegalStateException("messages.yml names unknown mob types " + unknown);
    }
  }
}
