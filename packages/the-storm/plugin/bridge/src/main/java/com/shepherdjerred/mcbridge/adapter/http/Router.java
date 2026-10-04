package com.shepherdjerred.mcbridge.adapter.http;

import com.shepherdjerred.mcbridge.domain.BridgeException;
import com.shepherdjerred.mcbridge.domain.ErrorCode;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

/** Method + path routing with {@code :name} segments. */
public final class Router {
  /** Handles one routed request. */
  @FunctionalInterface
  public interface Handler {
    Response handle(Request request);
  }

  private record Route(String method, List<String> segments, Handler handler) {}

  /** A matched route and its path parameters. */
  public record Match(Handler handler, Map<String, String> params) {}

  private final List<Route> routes = new ArrayList<>();

  /** Registers a route; {@code pattern} segments starting with {@code :} capture parameters. */
  public Router add(String method, String pattern, Handler handler) {
    routes.add(new Route(method, segments(pattern), handler));
    return this;
  }

  /**
   * Finds the handler for a request.
   *
   * @throws BridgeException {@code not_found} when no route matches the method and path
   */
  public Match match(String method, String path) {
    List<String> requested = segments(path);
    for (Route route : routes) {
      if (route.method().equals(method)) {
        Optional<Map<String, String>> params = bind(route.segments(), requested);
        if (params.isPresent()) {
          return new Match(route.handler(), params.get());
        }
      }
    }
    throw new BridgeException(ErrorCode.NOT_FOUND, "no route for " + method + " " + path);
  }

  private static Optional<Map<String, String>> bind(List<String> pattern, List<String> path) {
    if (pattern.size() != path.size()) {
      return Optional.empty();
    }
    Map<String, String> params = new HashMap<>();
    for (int i = 0; i < pattern.size(); i++) {
      String expected = pattern.get(i);
      String actual = path.get(i);
      if (expected.startsWith(":")) {
        params.put(expected.substring(1), actual);
      } else if (!expected.equals(actual)) {
        return Optional.empty();
      }
    }
    return Optional.of(Map.copyOf(params));
  }

  private static List<String> segments(String path) {
    List<String> segments = new ArrayList<>();
    for (String segment : path.split("/", -1)) {
      if (!segment.isEmpty()) {
        segments.add(segment);
      }
    }
    return segments;
  }
}
