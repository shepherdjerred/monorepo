package com.shepherdjerred.thestorm.arena.adapter.db;

import com.shepherdjerred.thestorm.arena.app.store.SettlementStore.Change;
import com.shepherdjerred.thestorm.arena.domain.geometry.BlockPos;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.DataInputStream;
import java.io.DataOutputStream;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.util.ArrayList;
import java.util.List;
import java.util.zip.GZIPInputStream;
import java.util.zip.GZIPOutputStream;

/** Versioned, bounded backup encoding; disk work stays on the database writer. */
final class SettlementCodec {
  private SettlementCodec() {}

  static byte[] encode(List<Change> changes) {
    var bytes = new ByteArrayOutputStream();
    try (var out = new DataOutputStream(new GZIPOutputStream(bytes))) {
      out.writeInt(1);
      out.writeInt(changes.size());
      for (var change : changes) {
        out.writeInt(change.block().x());
        out.writeInt(change.block().y());
        out.writeInt(change.block().z());
        out.writeUTF(change.before());
        out.writeUTF(change.after());
      }
    } catch (IOException failure) {
      throw new UncheckedIOException(failure);
    }
    return bytes.toByteArray();
  }

  static List<Change> decode(byte[] bytes) {
    try (var in = new DataInputStream(new GZIPInputStream(new ByteArrayInputStream(bytes)))) {
      if (in.readInt() != 1) {
        throw new IllegalStateException("Unknown settlement backup format");
      }
      var count = in.readInt();
      if (count < 0 || count > 500_000) {
        throw new IllegalStateException("Invalid settlement backup size");
      }
      var changes = new ArrayList<Change>(count);
      for (var i = 0; i < count; i++) {
        changes.add(
            new Change(
                new BlockPos(in.readInt(), in.readInt(), in.readInt()),
                in.readUTF(),
                in.readUTF()));
      }
      if (in.read() != -1) {
        throw new IllegalStateException("Trailing settlement backup data");
      }
      return List.copyOf(changes);
    } catch (IOException failure) {
      throw new UncheckedIOException(failure);
    }
  }
}
