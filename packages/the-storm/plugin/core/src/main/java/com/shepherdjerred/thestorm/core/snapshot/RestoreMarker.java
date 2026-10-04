package com.shepherdjerred.thestorm.core.snapshot;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;
import org.bukkit.NamespacedKey;
import org.bukkit.entity.Player;
import org.bukkit.persistence.PersistentDataType;
import org.bukkit.plugin.Plugin;

/**
 * A fingerprint saved in the same player data record as a restored inventory. Each module uses its
 * own key, so one game's proof never retires another's snapshot.
 */
public final class RestoreMarker {

  private final NamespacedKey key;

  /**
   * Marks under {@code plugin}'s namespace with {@code keyName}, such as {@code
   * arena_restored_snapshot}.
   */
  public RestoreMarker(Plugin plugin, String keyName) {
    key = new NamespacedKey(plugin, keyName);
  }

  public void record(Player player, Snapshot snapshot) {
    player.getPersistentDataContainer().set(key, PersistentDataType.STRING, fingerprint(snapshot));
  }

  public boolean matches(Player player, Snapshot snapshot) {
    return fingerprint(snapshot)
        .equals(player.getPersistentDataContainer().get(key, PersistentDataType.STRING));
  }

  private static String fingerprint(Snapshot snapshot) {
    try {
      var digest = MessageDigest.getInstance("SHA-256");
      digest.update(snapshot.player().toString().getBytes(StandardCharsets.UTF_8));
      digest.update(snapshot.scope().getBytes(StandardCharsets.UTF_8));
      digest.update(snapshot.takenAt().toString().getBytes(StandardCharsets.UTF_8));
      digest.update(snapshot.position().toString().getBytes(StandardCharsets.UTF_8));
      digest.update(snapshot.vitals().toString().getBytes(StandardCharsets.UTF_8));
      digest.update(snapshot.experience().toString().getBytes(StandardCharsets.UTF_8));
      digest.update(snapshot.effects().toString().getBytes(StandardCharsets.UTF_8));
      digest.update(snapshot.inventory().bytes());
      return HexFormat.of().formatHex(digest.digest());
    } catch (NoSuchAlgorithmException impossible) {
      throw new IllegalStateException("SHA-256 is required by Java", impossible);
    }
  }
}
