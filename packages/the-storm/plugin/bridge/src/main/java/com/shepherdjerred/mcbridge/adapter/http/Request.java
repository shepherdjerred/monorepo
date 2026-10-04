package com.shepherdjerred.mcbridge.adapter.http;

import com.shepherdjerred.mcbridge.domain.BridgeException;
import java.util.Map;
import java.util.Set;

/** A routed request: path parameters, decoded query parameters and the raw body. */
public final class Request {
  private final Map<String, String> params;
  private final Map<String, String> query;
  private final byte[] body;

  public Request(Map<String, String> params, Map<String, String> query, byte[] body) {
    this.params = Map.copyOf(params);
    this.query = Map.copyOf(query);
    this.body = body.clone();
  }

  /** The raw body (empty for GET). */
  public byte[] body() {
    return body.clone();
  }

  /** True when the request carried a body. */
  public boolean hasBody() {
    return body.length > 0;
  }

  /** The body as a strict JSON object with only {@code allowed} keys. */
  public Fields json(Set<String> allowed) {
    return Fields.parseBody(body, allowed);
  }

  /** A required path parameter. */
  public String param(String name) {
    String value = params.get(name);
    if (value == null) {
      throw new IllegalStateException("route has no :" + name + " parameter");
    }
    return value;
  }

  /** An optional non-negative long query parameter. */
  public long queryLong(String name, long fallbackWhenAbsent) {
    String raw = query.get(name);
    if (raw == null) {
      return fallbackWhenAbsent;
    }
    try {
      long value = Long.parseLong(raw);
      if (value < 0) {
        throw BridgeException.badRequest("query " + name + " must not be negative");
      }
      return value;
    } catch (NumberFormatException e) {
      throw BridgeException.badRequest("query " + name + " must be an integer");
    }
  }

  /** Rejects query parameters outside {@code allowed}. */
  public void requireQueryKeys(Set<String> allowed) {
    for (String key : query.keySet()) {
      if (!allowed.contains(key)) {
        throw BridgeException.badRequest("unknown query parameter " + key);
      }
    }
  }
}
