package com.shepherdjerred.thestorm.creative.adapter.paper;

import com.shepherdjerred.thestorm.core.snapshot.RestoreMarker;
import com.shepherdjerred.thestorm.creative.app.VisitBody;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;
import org.bukkit.NamespacedKey;
import org.bukkit.entity.Player;
import org.bukkit.persistence.PersistentDataType;
import org.bukkit.plugin.Plugin;

/**
 * Proof that a restored survival body, ender chest included, reached the same player-data file as
 * the inventory. The shared marker digest does not cover the ender chest.
 */
public final class CreativeMarker {

  private final NamespacedKey key;

  public CreativeMarker(Plugin plugin) {
    key = new NamespacedKey(plugin, "creative_restored_body");
  }

  public NamespacedKey key() {
    return key;
  }

  public void record(Player player, VisitBody body) {
    player.getPersistentDataContainer().set(key, PersistentDataType.STRING, fingerprint(body));
  }

  public boolean matches(Player player, VisitBody body) {
    return fingerprint(body)
        .equals(player.getPersistentDataContainer().get(key, PersistentDataType.STRING));
  }

  /** Digest of the survival snapshot plus the ender chest. */
  public static String fingerprint(VisitBody body) {
    try {
      var digest = MessageDigest.getInstance("SHA-256");
      digest.update(RestoreMarker.fingerprint(body.snapshot()).getBytes(StandardCharsets.UTF_8));
      digest.update(body.role().wire().getBytes(StandardCharsets.UTF_8));
      digest.update(body.enderChest().bytes());
      return HexFormat.of().formatHex(digest.digest());
    } catch (NoSuchAlgorithmException impossible) {
      throw new IllegalStateException("SHA-256 is required by Java", impossible);
    }
  }
}
