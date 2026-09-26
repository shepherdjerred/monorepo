package com.shepherdjerred.thestorm.core.config;

import static java.util.stream.Collectors.joining;

import com.shepherdjerred.thestorm.core.result.Result;
import java.util.List;
import tools.jackson.core.JacksonException;
import tools.jackson.databind.DatabindException;
import tools.jackson.databind.DeserializationFeature;
import tools.jackson.databind.json.JsonMapper;
import tools.jackson.dataformat.yaml.YAMLMapper;

/**
 * Parses YAML into records, rejecting anything that does not match exactly.
 *
 * <p>Unknown keys, missing constructor properties, nulls and trailing content all fail. Records
 * enforce their own invariants in compact constructors; a thrown {@link IllegalArgumentException}
 * becomes a {@link Problem} at the offending path. The caller receives either a fully valid value
 * or every problem found, never a partial result.
 */
public final class StrictYaml {

  private static final YAMLMapper YAML =
      YAMLMapper.builder()
          .enable(
              DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES,
              DeserializationFeature.FAIL_ON_NULL_FOR_PRIMITIVES,
              DeserializationFeature.FAIL_ON_MISSING_CREATOR_PROPERTIES,
              DeserializationFeature.FAIL_ON_NULL_CREATOR_PROPERTIES,
              DeserializationFeature.FAIL_ON_TRAILING_TOKENS)
          .build();

  private static final JsonMapper JSON =
      JsonMapper.builder()
          .enable(
              DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES,
              DeserializationFeature.FAIL_ON_NULL_FOR_PRIMITIVES,
              DeserializationFeature.FAIL_ON_MISSING_CREATOR_PROPERTIES,
              DeserializationFeature.FAIL_ON_NULL_CREATOR_PROPERTIES,
              DeserializationFeature.FAIL_ON_TRAILING_TOKENS)
          .build();

  private StrictYaml() {}

  /** Parses a YAML document into {@code type}. */
  public static <T> Result<T, List<Problem>> parse(String source, String yaml, Class<T> type) {
    try {
      return Result.ok(YAML.readValue(yaml, type));
    } catch (JacksonException e) {
      return Result.err(List.of(toProblem(source, e)));
    }
  }

  /** Parses a JSON document into {@code type} with the same strictness. */
  public static <T> Result<T, List<Problem>> parseJson(String source, String json, Class<T> type) {
    try {
      return Result.ok(JSON.readValue(json, type));
    } catch (JacksonException e) {
      return Result.err(List.of(toProblem(source, e)));
    }
  }

  private static Problem toProblem(String source, JacksonException exception) {
    var path =
        exception instanceof DatabindException databind
            ? databind.getPath().stream()
                .map(StrictYaml::describe)
                .collect(joining("."))
                .replace(".[", "[")
            : "";
    return new Problem(source, path, rootMessage(exception));
  }

  private static String describe(JacksonException.Reference reference) {
    var name = reference.getPropertyName();
    return name != null ? name : "[" + reference.getIndex() + "]";
  }

  private static String rootMessage(Throwable throwable) {
    // Throwable#getCause returns null rather than itself, so this terminates.
    Throwable current = throwable;
    for (var cause = current.getCause(); cause != null; cause = cause.getCause()) {
      current = cause;
    }
    if (current instanceof JacksonException jackson) {
      return jackson.getOriginalMessage();
    }
    var message = current.getMessage();
    return message != null ? message : current.getClass().getSimpleName();
  }
}
