package com.shepherdjerred.thestorm.shops.app;

import com.shepherdjerred.thestorm.shops.domain.price.Price;
import com.shepherdjerred.thestorm.shops.domain.price.ShopPrices;
import com.shepherdjerred.thestorm.shops.domain.shop.BlockPos;
import com.shepherdjerred.thestorm.shops.domain.shop.ItemFingerprint;
import com.shepherdjerred.thestorm.shops.domain.shop.ShopOwner;
import com.shepherdjerred.thestorm.shops.domain.shop.SignShop;
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
import java.util.UUID;

/** Detached, versioned shop definitions. Native inventory templates remain opaque. */
public final class ShopArchive {
  private ShopArchive() {}

  public static byte[] encode(List<SignShop> shops) {
    var bytes = new ByteArrayOutputStream();
    try (var out = new DataOutputStream(bytes)) {
      out.writeInt(1);
      out.writeInt(shops.size());
      for (var shop : shops) {
        out.writeLong(shop.id());
        position(out, shop.sign());
        out.writeBoolean(shop.container().isPresent());
        if (shop.container().isPresent()) {
          position(out, shop.container().get());
        }
        var owner = (ShopOwner.Player) shop.owner();
        out.writeUTF(owner.id().toString());
        out.writeUTF(owner.name());
        out.writeInt(shop.quantity());
        out.writeLong(shop.prices().buy().map(Price::crystals).orElse(0L));
        out.writeLong(shop.prices().sell().map(Price::crystals).orElse(0L));
        out.writeBoolean(shop.item().isPresent());
        if (shop.item().isPresent()) {
          var item = shop.item().get();
          out.writeUTF(item.material());
          var template = item.template().getBytes(java.nio.charset.StandardCharsets.UTF_8);
          out.writeInt(template.length);
          out.write(template);
          out.writeBoolean(item.special());
        }
        out.writeLong(shop.createdAt().toEpochMilli());
      }
    } catch (IOException e) {
      throw new UncheckedIOException(e);
    }
    return bytes.toByteArray();
  }

  public static List<SignShop> decode(byte[] bytes) {
    try (var in = new DataInputStream(new ByteArrayInputStream(bytes))) {
      if (in.readInt() != 1) {
        throw new IllegalStateException("unknown shop definition archive version");
      }
      var count = in.readInt();
      if (count < 0 || count > 5000) {
        throw new IllegalStateException("invalid archived shop count");
      }
      var shops = new ArrayList<SignShop>(count);
      for (var i = 0; i < count; i++) {
        shops.add(readShop(in));
      }
      if (in.available() != 0) {
        throw new IllegalStateException("shop definition archive has trailing data");
      }
      return List.copyOf(shops);
    } catch (IOException e) {
      throw new UncheckedIOException(e);
    }
  }

  private static SignShop readShop(DataInputStream in) throws IOException {
    var id = in.readLong();
    var sign = position(in);
    var container = in.readBoolean() ? Optional.of(position(in)) : Optional.<BlockPos>empty();
    var owner = new ShopOwner.Player(UUID.fromString(in.readUTF()), in.readUTF());
    var quantity = in.readInt();
    var buy = in.readLong();
    var sell = in.readLong();
    var prices =
        new ShopPrices(
            buy == 0 ? Optional.empty() : Optional.of(Price.of(buy)),
            sell == 0 ? Optional.empty() : Optional.of(Price.of(sell)));
    var item = Optional.<ItemFingerprint>empty();
    if (in.readBoolean()) {
      var material = in.readUTF();
      var length = in.readInt();
      if (length < 1 || length > 1_048_576 || length > in.available()) {
        throw new IllegalStateException("invalid archived shop item template size");
      }
      var template = new String(in.readNBytes(length), java.nio.charset.StandardCharsets.UTF_8);
      item = Optional.of(new ItemFingerprint(material, template, in.readBoolean()));
    }
    return new SignShop(
        id, sign, container, owner, quantity, prices, item, Instant.ofEpochMilli(in.readLong()));
  }

  private static void position(DataOutputStream out, BlockPos pos) throws IOException {
    out.writeUTF(pos.world().toString());
    out.writeInt(pos.x());
    out.writeInt(pos.y());
    out.writeInt(pos.z());
  }

  private static BlockPos position(DataInputStream in) throws IOException {
    return new BlockPos(UUID.fromString(in.readUTF()), in.readInt(), in.readInt(), in.readInt());
  }
}
