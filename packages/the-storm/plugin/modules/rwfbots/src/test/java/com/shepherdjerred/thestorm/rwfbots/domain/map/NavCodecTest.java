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
  void writesDistanceFieldsInSortedOrderWhateverTheInputOrder() {
    var reversed = new java.util.LinkedHashMap<String, DistanceField>();
    nav.distanceFields().keySet().stream()
        .sorted(java.util.Comparator.reverseOrder())
        .forEach(name -> reversed.put(name, nav.distanceFields().get(name)));
    var shuffled =
        new NavArtifact(
            nav.formatVersion(),
            nav.generatorVersion(),
            nav.mapId(),
            nav.blocksSha256(),
            nav.sites(),
            nav.grid(),
            nav.graph(),
            nav.regions(),
            nav.cover(),
            nav.chokepoints(),
            nav.routes(),
            reversed,
            nav.bombScreens());

    assertThat(shuffled.distanceFields().keySet())
        .containsExactlyElementsOf(nav.distanceFields().keySet().stream().sorted().toList());
    assertThat(NavCodec.encode(shuffled)).isEqualTo(NavCodec.encode(nav));
  }

  @Test
  void preservesRawDistanceFloatBitsThroughTheActualArtifactCodec() {
    var patterns =
        new int[] {0, Integer.MIN_VALUE, 1, 0x007fffff, 0x00800000, 0x7f7fffff, 0x7f800000};
    var values = new float[nav.graph().nodeCount()];
    for (var i = 0; i < values.length; i++)
      values[i] = Float.intBitsToFloat(patterns[i % patterns.length]);
    var fields = new java.util.TreeMap<>(nav.distanceFields());
    fields.put("raw-bit-regression", new DistanceField(values));
    var withPatterns =
        new NavArtifact(
            nav.formatVersion(),
            nav.generatorVersion(),
            nav.mapId(),
            nav.blocksSha256(),
            nav.sites(),
            nav.grid(),
            nav.graph(),
            nav.regions(),
            nav.cover(),
            nav.chokepoints(),
            nav.routes(),
            fields,
            nav.bombScreens());
    var wire = NavCodec.encode(withPatterns);
    var decoded = NavCodec.decode(wire);
    assertThat(decoded).isInstanceOf(Result.Ok.class);
    var back = ((Result.Ok<NavArtifact, NavCodec.CodecError>) decoded).value();
    var actual = back.distanceTo("raw-bit-regression");
    for (var i = 0; i < actual.size(); i++)
      assertThat(Float.floatToRawIntBits(actual.at(i)))
          .as("distance float bits at %s", i)
          .isEqualTo(patterns[i % patterns.length]);
    assertThat(NavCodec.encode(back)).isEqualTo(wire);
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
