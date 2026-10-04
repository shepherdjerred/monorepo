package com.shepherdjerred.thestorm.rwfbots.domain.map;

import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.core.result.Result;
import java.nio.ByteBuffer;
import java.util.Arrays;
import org.junit.jupiter.api.Test;

final class NavCodecTest {

  private final NavArtifact nav = SyntheticMap.bake();

  @Test
  void roundTripsAnArtifact() {
    var bytes = NavCodec.encode(nav);
    var decoded = NavCodec.decode(bytes);
    assertThat(decoded).isInstanceOf(Result.Ok.class);
    var back = ((Result.Ok<NavArtifact, NavCodec.CodecError>) decoded).value();
    assertThat(back).isEqualTo(nav);
    assertThat(NavCodec.encode(back)).isEqualTo(bytes);
    assertThat(back.validate()).isEmpty();
  }

  @Test
  void rejectsBadMagic() {
    var bytes = NavCodec.encode(nav);
    bytes[0] = 'X';
    assertThat(error(bytes)).contains("magic");
  }

  @Test
  void rejectsUnknownFormatVersion() {
    var bytes = NavCodec.encode(nav);
    ByteBuffer.wrap(bytes).putInt(4, 99);
    assertThat(error(bytes)).contains("version");
  }

  @Test
  void rejectsTruncation() {
    var bytes = NavCodec.encode(nav);
    assertThat(error(Arrays.copyOf(bytes, bytes.length - 10))).isNotBlank();
    assertThat(error(Arrays.copyOf(bytes, 6))).isNotBlank();
  }

  @Test
  void rejectsCorruptBody() {
    var bytes = NavCodec.encode(nav);
    for (var i = 20; i < bytes.length; i += 97) {
      var copy = bytes.clone();
      copy[i] ^= 0x55;
      assertThat(NavCodec.decode(copy)).as("flip at %s", i).isInstanceOf(Result.Err.class);
    }
  }

  private static String error(byte[] bytes) {
    var result = NavCodec.decode(bytes);
    assertThat(result).isInstanceOf(Result.Err.class);
    return ((Result.Err<NavArtifact, NavCodec.CodecError>) result).error().message();
  }
}
