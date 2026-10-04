package com.shepherdjerred.thestorm.towns.adapter.archive;

import com.shepherdjerred.thestorm.mail.app.MailItem;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.DataInputStream;
import java.io.DataOutputStream;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.util.ArrayList;
import java.util.List;

/** Versioned inventory encoding keeps every item's native metadata without interpreting it. */
public final class ItemsArchive {
  private ItemsArchive() {}

  public static byte[] encode(List<MailItem> items) {
    var bytes = new ByteArrayOutputStream();
    try (var out = new DataOutputStream(bytes)) {
      out.writeInt(1);
      out.writeInt(items.size());
      for (var item : items) {
        var stack = item.bytes();
        out.writeInt(stack.length);
        out.write(stack);
      }
    } catch (IOException e) {
      throw new UncheckedIOException(e);
    }
    return bytes.toByteArray();
  }

  public static List<MailItem> decode(byte[] bytes) {
    try (var in = new DataInputStream(new ByteArrayInputStream(bytes))) {
      if (in.readInt() != 1) {
        throw new IllegalStateException("unknown shop item archive version");
      }
      var size = in.readInt();
      if (size < 0 || size > 524_288) {
        throw new IllegalStateException("invalid shop item count");
      }
      var items = new ArrayList<MailItem>(size);
      for (var i = 0; i < size; i++) {
        var length = in.readInt();
        if (length <= 0 || length > 1_048_576 || length > in.available()) {
          throw new IllegalStateException("invalid shop item length");
        }
        items.add(new MailItem(in.readNBytes(length)));
      }
      if (in.available() != 0) {
        throw new IllegalStateException("shop item archive has trailing data");
      }
      return List.copyOf(items);
    } catch (IOException e) {
      throw new UncheckedIOException(e);
    }
  }
}
