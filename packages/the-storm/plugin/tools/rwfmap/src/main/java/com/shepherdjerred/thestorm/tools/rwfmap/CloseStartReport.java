package com.shepherdjerred.thestorm.tools.rwfmap;

import com.shepherdjerred.thestorm.rwfbots.domain.geom.Vec3;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.util.Arrays;
import java.util.List;
import java.util.Objects;
import tools.jackson.databind.DeserializationFeature;
import tools.jackson.databind.json.JsonMapper;

/** Neutral geometry receipt consumed by scenario authoring; it does not admit a training map. */
record CloseStartReport(
    int schema, String kind, String map, String blocksSha256, List<Start> starts) {
  private static final JsonMapper JSON =
      JsonMapper.builder().enable(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES).build();
  static final Contract CONTRACT = contract();

  record Contract(
      int schema,
      String kind,
      List<String> fields,
      List<String> startFields,
      double minSeparation,
      double targetSeparation,
      double maxSeparation,
      int clearanceRadius) {}

  record Start(List<Double> position, float yaw, float pitch) {
    static Start toward(Vec3 from, Vec3 to) {
      var delta = to.minus(from);
      return new Start(
          List.of(from.x(), from.y(), from.z()),
          (float) Math.toDegrees(Math.atan2(-delta.x(), delta.z())),
          0);
    }
  }

  static CloseStartReport of(MapFolder map, CloseStarts.Pair pair) {
    return new CloseStartReport(
        CONTRACT.schema(),
        CONTRACT.kind(),
        map.id(),
        map.schematic().sha256(),
        List.of(
            Start.toward(pair.first(), pair.second()), Start.toward(pair.second(), pair.first())));
  }

  String json() {
    return JSON.writeValueAsString(this);
  }

  private static Contract contract() {
    try (var input =
        Objects.requireNonNull(
            CloseStartReport.class.getResourceAsStream("/rwf-close-starts.json"))) {
      var value = JSON.readValue(input, Contract.class);
      if (value.schema() != 1
          || !value.kind().equals("rwf-close-starts")
          || !value.fields().equals(names(CloseStartReport.class))
          || !value.startFields().equals(names(Start.class))
          || value.minSeparation() <= 0
          || value.minSeparation() > value.targetSeparation()
          || value.targetSeparation() > value.maxSeparation()
          || value.clearanceRadius() < 1) {
        throw new IllegalStateException("Invalid close-start geometry contract");
      }
      return value;
    } catch (IOException error) {
      throw new UncheckedIOException(error);
    }
  }

  private static List<String> names(Class<?> type) {
    return Arrays.stream(type.getRecordComponents())
        .map(java.lang.reflect.RecordComponent::getName)
        .toList();
  }
}
