package com.shepherdjerred.thestorm.qol.adapter.paper;

import com.shepherdjerred.thestorm.qol.domain.grave.Grave;
import com.shepherdjerred.thestorm.qol.domain.grave.GraveContents;
import com.shepherdjerred.thestorm.qol.domain.grave.GraveItem;
import com.shepherdjerred.thestorm.qol.domain.grave.GravePos;
import com.shepherdjerred.thestorm.qol.domain.grave.ItemBytes;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.DataInputStream;
import java.io.DataOutputStream;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.OptionalInt;
import java.util.UUID;
import org.bukkit.NamespacedKey;
import org.bukkit.entity.Player;
import org.bukkit.persistence.PersistentDataType;

/**
 * A death's item handoff is saved in player.dat with the emptied inventory before SQLite is
 * touched. A crash can therefore leave either the old inventory or this recoverable handoff, but
 * cannot leave an empty inventory with no copy of the items.
 */
final class GraveHandoff {

  private static final NamespacedKey DEATH = new NamespacedKey("thestorm", "grave_death_handoff");
  private static final NamespacedKey RECEIPT = new NamespacedKey("thestorm", "grave_claim_receipt");
  private static final int VERSION = 1;
  private static final int MAX_ITEMS = 256;
  private static final int MAX_ITEM_BYTES = 1_048_576;

  private GraveHandoff() {}

  static void rememberDeath(Player player, GraveContents contents) {
    player.getPersistentDataContainer().set(DEATH, PersistentDataType.BYTE_ARRAY, encode(contents));
  }

  static Optional<GraveContents> death(Player player) {
    var encoded = player.getPersistentDataContainer().get(DEATH, PersistentDataType.BYTE_ARRAY);
    return encoded == null ? Optional.empty() : Optional.of(decode(encoded));
  }

  static boolean hasPendingDeath(Player player) {
    return player.getPersistentDataContainer().has(DEATH, PersistentDataType.BYTE_ARRAY);
  }

  static void clearDeath(Player player) {
    player.getPersistentDataContainer().remove(DEATH);
  }

  static void receipt(Player player, UUID token) {
    player.getPersistentDataContainer().set(RECEIPT, PersistentDataType.STRING, token.toString());
  }

  static Optional<UUID> receipt(Player player) {
    var token = player.getPersistentDataContainer().get(RECEIPT, PersistentDataType.STRING);
    return token == null ? Optional.empty() : Optional.of(UUID.fromString(token));
  }

  static void clearReceipt(Player player) {
    player.getPersistentDataContainer().remove(RECEIPT);
  }

  private static byte[] encode(GraveContents contents) {
    try {
      var bytes = new ByteArrayOutputStream();
      var out = new DataOutputStream(bytes);
      var grave = contents.grave();
      out.writeInt(VERSION);
      out.writeUTF(grave.id().toString());
      out.writeUTF(grave.owner().toString());
      out.writeUTF(grave.ownerName());
      out.writeUTF(grave.pos().world());
      out.writeInt(grave.pos().x());
      out.writeInt(grave.pos().y());
      out.writeInt(grave.pos().z());
      out.writeLong(grave.createdAt().toEpochMilli());
      out.writeUTF(grave.replaced());
      out.writeInt(contents.items().size());
      for (var item : contents.items()) {
        out.writeInt(item.index());
        out.writeInt(item.slot().orElse(-1));
        var itemBytes = item.item().bytes();
        out.writeInt(itemBytes.length);
        out.write(itemBytes);
      }
      out.flush();
      return bytes.toByteArray();
    } catch (IOException e) {
      throw new UncheckedIOException("could not encode grave handoff", e);
    }
  }

  private static GraveContents decode(byte[] encoded) {
    try {
      var in = new DataInputStream(new ByteArrayInputStream(encoded));
      if (in.readInt() != VERSION) {
        throw new IllegalStateException("unknown grave handoff version");
      }
      var grave =
          new Grave(
              UUID.fromString(in.readUTF()),
              UUID.fromString(in.readUTF()),
              in.readUTF(),
              new GravePos(in.readUTF(), in.readInt(), in.readInt(), in.readInt()),
              Instant.ofEpochMilli(in.readLong()),
              in.readUTF());
      var count = in.readInt();
      if (count < 0 || count > MAX_ITEMS) {
        throw new IllegalStateException("invalid grave handoff item count: " + count);
      }
      var items = new ArrayList<GraveItem>(count);
      for (var i = 0; i < count; i++) {
        var index = in.readInt();
        var slot = in.readInt();
        var length = in.readInt();
        if (length < 1 || length > MAX_ITEM_BYTES) {
          throw new IllegalStateException("invalid grave handoff item size: " + length);
        }
        var payload = new byte[length];
        in.readFully(payload);
        items.add(
            new GraveItem(
                index,
                slot < 0 ? OptionalInt.empty() : OptionalInt.of(slot),
                ItemBytes.of(payload)));
      }
      if (in.available() != 0) {
        throw new IllegalStateException("grave handoff has trailing data");
      }
      return new GraveContents(grave, List.copyOf(items));
    } catch (IOException e) {
      throw new UncheckedIOException("could not decode grave handoff", e);
    }
  }
}
