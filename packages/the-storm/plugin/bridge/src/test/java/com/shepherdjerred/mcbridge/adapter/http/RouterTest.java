package com.shepherdjerred.mcbridge.adapter.http;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.google.gson.JsonObject;
import com.shepherdjerred.mcbridge.domain.BridgeException;
import com.shepherdjerred.mcbridge.domain.ErrorCode;
import org.junit.jupiter.api.Test;

class RouterTest {
  private static final Router.Handler OK = request -> Response.json(new JsonObject());

  @Test
  void matchesMethodPathAndBindsParameters() {
    Router router =
        new Router()
            .add("GET", "/v1/snapshots", OK)
            .add("GET", "/v1/snapshots/:id", OK)
            .add("POST", "/v1/snapshots/:id/restore", OK);

    assertThat(router.match("GET", "/v1/snapshots").params()).isEmpty();
    assertThat(router.match("GET", "/v1/snapshots/snap-1").params()).containsEntry("id", "snap-1");
    assertThat(router.match("POST", "/v1/snapshots/snap-1/restore").params())
        .containsEntry("id", "snap-1");
  }

  @Test
  void unknownRoutesAreNotFound() {
    Router router = new Router().add("GET", "/v1/health", OK);

    assertThatThrownBy(() -> router.match("POST", "/v1/health"))
        .isInstanceOfSatisfying(
            BridgeException.class, e -> assertThat(e.code()).isEqualTo(ErrorCode.NOT_FOUND));
    assertThatThrownBy(() -> router.match("GET", "/v1/health/extra"))
        .isInstanceOf(BridgeException.class);
  }

  @Test
  void rendersErrorsInTheContractShape() {
    Response response = Response.error(ErrorCode.TOO_LARGE, "too big");

    assertThat(response.status()).isEqualTo(413);
    assertThat(new String(response.body(), java.nio.charset.StandardCharsets.UTF_8))
        .isEqualTo("{\"error\":\"too big\",\"code\":\"too_large\"}");
  }
}
