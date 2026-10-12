package com.shepherdjerred.mcbridge.adapter.http;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.shepherdjerred.mcbridge.domain.BlockPos;
import com.shepherdjerred.mcbridge.domain.Box;
import com.shepherdjerred.mcbridge.domain.BridgeException;
import java.nio.charset.StandardCharsets;
import java.util.Set;
import org.junit.jupiter.api.Test;

class FieldsTest {
  private static Fields parse(String json, Set<String> allowed) {
    return Fields.parseBody(json.getBytes(StandardCharsets.UTF_8), allowed);
  }

  @Test
  void readsTypedFieldsAndNormalizesBoxes() {
    Fields body =
        parse(
            "{\"box\":{\"world\":\"world\",\"min\":{\"x\":3,\"y\":5,\"z\":1},"
                + "\"max\":{\"x\":0,\"y\":4,\"z\":2}},\"label\":\"a\",\"ignoreAir\":true}",
            Set.of("box", "label", "ignoreAir"));

    Box box = body.box("box");
    assertThat(box.min()).isEqualTo(new BlockPos(0, 4, 1));
    assertThat(box.max()).isEqualTo(new BlockPos(3, 5, 2));
    assertThat(body.optionalString("label")).contains("a");
    assertThat(body.bool("ignoreAir")).isTrue();
    assertThat(body.optionalBlockPos("at")).isEmpty();
  }

  @Test
  void rejectsUnknownKeysAtEveryLevel() {
    assertThatThrownBy(() -> parse("{\"command\":\"list\",\"extra\":1}", Set.of("command")))
        .isInstanceOf(BridgeException.class)
        .hasMessageContaining("unknown keys [extra]");
    Fields body = parse("{\"at\":{\"x\":1,\"y\":2,\"z\":3,\"w\":4}}", Set.of("at"));
    assertThatThrownBy(() -> body.blockPos("at")).hasMessageContaining("body.at has unknown keys");
  }

  @Test
  void rejectsWrongTypesAndNonIntegers() {
    Fields body =
        parse("{\"steps\":1.5,\"session\":3,\"x\":\"1\"}", Set.of("steps", "session", "x"));

    assertThatThrownBy(() -> body.integer("steps")).hasMessageContaining("32-bit integer");
    assertThatThrownBy(() -> body.string("session")).hasMessageContaining("must be a string");
    assertThatThrownBy(() -> body.integer("x")).hasMessageContaining("must be an integer");
    assertThatThrownBy(() -> body.string("missing")).hasMessageContaining("is required");
  }

  @Test
  void rejectsBodiesThatAreNotObjects() {
    assertThatThrownBy(() -> parse("[1]", Set.of())).hasMessageContaining("JSON object");
    assertThatThrownBy(() -> parse("{", Set.of())).hasMessageContaining("not valid JSON");
  }
}
