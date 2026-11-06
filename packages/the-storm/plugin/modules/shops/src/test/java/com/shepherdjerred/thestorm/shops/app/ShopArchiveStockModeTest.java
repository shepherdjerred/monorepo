package com.shepherdjerred.thestorm.shops.app;

import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.shops.domain.price.ShopPrices;
import com.shepherdjerred.thestorm.shops.domain.shop.BlockPos;
import com.shepherdjerred.thestorm.shops.domain.shop.ShopOwner;
import com.shepherdjerred.thestorm.shops.domain.shop.SignShop;
import java.nio.ByteBuffer;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.Test;

final class ShopArchiveStockModeTest {
  private static SignShop shop(boolean finite) {
    var position = new BlockPos(new UUID(9, 9), 0, 64, 0);
    return new SignShop(
        1,
        position,
        Optional.of(position),
        new ShopOwner.Admin(finite),
        1,
        ShopPrices.buyOnly(10),
        Optional.empty(),
        Instant.EPOCH);
  }

  @Test
  void custodyStockModeSurvivesPackingAndUnpacking() {
    var original = shop(true);
    var archive = ShopArchive.encode(List.of(original));
    assertThat(ByteBuffer.wrap(archive).getInt()).isEqualTo(3);
    var recovered = ShopArchive.decode(archive);
    assertThat(recovered).containsExactly(original);
    assertThat(recovered.getFirst().unlimitedStock()).isFalse();
  }

  @Test
  void versionTwoAdminShopsKeepUnlimitedStockEvenWithAContainer() {
    var original = shop(false);
    var archive = ShopArchive.encode(List.of(original));
    ByteBuffer.wrap(archive).putInt(2);
    var recovered = ShopArchive.decode(archive);
    assertThat(recovered).containsExactly(original);
    assertThat(recovered.getFirst().unlimitedStock()).isTrue();
  }
}
