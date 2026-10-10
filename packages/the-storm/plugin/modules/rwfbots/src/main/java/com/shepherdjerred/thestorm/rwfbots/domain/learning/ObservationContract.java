package com.shepherdjerred.thestorm.rwfbots.domain.learning;

import java.util.EnumSet;
import java.util.List;
import java.util.Map;

/** Shared feature contract: unknown, duplicate, missing and nonfinite values are errors. */
public record ObservationContract(List<Field> fields) {
  public static final String ID = "rwf-combat-v1";

  public record Field(Feature feature, double scale) {
    public Field {
      if (!Double.isFinite(scale) || scale <= 0)
        throw new IllegalArgumentException("invalid feature scale");
    }
  }

  public ObservationContract {
    fields = List.copyOf(fields);
    var seen = EnumSet.noneOf(Feature.class);
    for (var field : fields) {
      if (!seen.add(field.feature()))
        throw new IllegalArgumentException("duplicate feature " + field.feature());
    }
    if (!seen.equals(EnumSet.allOf(Feature.class)))
      throw new IllegalArgumentException("incomplete feature contract");
  }

  public List<Double> encode(Map<Feature, Double> values) {
    if (!values.keySet().equals(EnumSet.allOf(Feature.class)))
      throw new IllegalArgumentException("incomplete observation");
    return fields.stream()
        .map(
            field -> {
              var value = java.util.Objects.requireNonNull(values.get(field.feature()));
              if (!Double.isFinite(value))
                throw new IllegalArgumentException("nonfinite observation");
              return Math.clamp(value / field.scale(), -1, 1);
            })
        .toList();
  }
}
