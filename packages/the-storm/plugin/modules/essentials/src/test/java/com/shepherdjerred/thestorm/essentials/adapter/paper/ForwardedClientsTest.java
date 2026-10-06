package com.shepherdjerred.thestorm.essentials.adapter.paper;

import static java.util.UUID.randomUUID;
import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

/** Shared proxy, local, multicast and hostnames cannot become IP-ban targets. */
final class ForwardedClientsTest {
  private org.bukkit.event.player.AsyncPlayerPreLoginEvent login(String peer, String forwarded)
      throws Exception {
    return login(randomUUID(), peer, forwarded);
  }

  private org.bukkit.event.player.AsyncPlayerPreLoginEvent login(
      java.util.UUID id, String peer, String forwarded) throws Exception {
    return new org.bukkit.event.player.AsyncPlayerPreLoginEvent(
        "Alice",
        java.net.InetAddress.getByName(forwarded),
        java.net.InetAddress.getByName(peer),
        id,
        false,
        new org.mockbukkit.mockbukkit.profile.PlayerProfileMock("Alice", id),
        "localhost",
        null);
  }

  private ForwardedClients clients(boolean enabled) {
    return new ForwardedClients(
        new com.shepherdjerred.thestorm.core.expansion.ManagedGameplay(
            (key, actor) -> java.util.concurrent.CompletableFuture.completedFuture(enabled),
            () -> {}),
        () -> true,
        ip -> java.util.Optional.of("IP banned"));
  }

  @org.junit.jupiter.api.Test
  void enforcementRefusesDirectUnverifiedConnectionsAndChecksVerifiedForwardedAddress()
      throws Exception {
    var clients = clients(true);
    var direct = login("8.8.8.8", "8.8.8.8");
    clients.login(direct);
    assertThat(clients.verified(direct.getUniqueId())).isEmpty();
    assertThat(direct.getLoginResult())
        .isEqualTo(org.bukkit.event.player.AsyncPlayerPreLoginEvent.Result.KICK_OTHER);
    var proxied = login("10.1.2.3", "8.8.8.8");
    clients.login(proxied);
    assertThat(clients.verified(proxied.getUniqueId())).contains("8.8.8.8");
    assertThat(proxied.getLoginResult())
        .isEqualTo(org.bukkit.event.player.AsyncPlayerPreLoginEvent.Result.KICK_OTHER);
    assertThat(proxied.kickMessage())
        .isEqualTo(net.kyori.adventure.text.Component.text("IP banned"));
  }

  @org.junit.jupiter.api.Test
  void disabledEnforcementPermitsDevelopmentConnectionsWithoutRecordingSharedIp() throws Exception {
    var clients = clients(false);
    var event = login("127.0.0.1", "127.0.0.1");
    clients.login(event);
    assertThat(clients.verified(event.getUniqueId())).isEmpty();
    assertThat(event.getLoginResult())
        .isEqualTo(org.bukkit.event.player.AsyncPlayerPreLoginEvent.Result.ALLOWED);
  }

  @org.junit.jupiter.api.Test
  void rolloutOutageUsesTheEnvironmentDefault() throws Exception {
    var failed =
        new com.shepherdjerred.thestorm.core.expansion.ManagedGameplay(
            (key, actor) ->
                java.util.concurrent.CompletableFuture.failedFuture(
                    new IllegalStateException("Flipt unavailable")),
            () -> {},
            false);
    var production = new ForwardedClients(failed, () -> true, ip -> java.util.Optional.empty());
    var login = login("127.0.0.1", "127.0.0.1");
    production.login(login);
    assertThat(login.getLoginResult())
        .isEqualTo(org.bukkit.event.player.AsyncPlayerPreLoginEvent.Result.ALLOWED);

    var beta =
        new com.shepherdjerred.thestorm.core.expansion.ManagedGameplay(
            (key, actor) ->
                java.util.concurrent.CompletableFuture.failedFuture(
                    new IllegalStateException("Flipt unavailable")),
            () -> {},
            true);
    var betaClients = new ForwardedClients(beta, () -> true, ip -> java.util.Optional.empty());
    var betaLogin = login("127.0.0.1", "127.0.0.1");
    betaClients.login(betaLogin);
    assertThat(betaLogin.getLoginResult())
        .isEqualTo(org.bukkit.event.player.AsyncPlayerPreLoginEvent.Result.KICK_OTHER);
  }

  @org.junit.jupiter.api.Test
  void unresolvedDisabledIpEnforcementDoesNotWaitForRolloutOrStaffState() throws Exception {
    var pending = new java.util.concurrent.CompletableFuture<Boolean>();
    var gameplay =
        new com.shepherdjerred.thestorm.core.expansion.ManagedGameplay(
            (key, actor) -> pending, () -> {}, false);
    var clients = new ForwardedClients(gameplay, () -> false, ip -> java.util.Optional.empty());
    var event = login("127.0.0.1", "127.0.0.1");

    clients.login(event);

    assertThat(event.getLoginResult())
        .isEqualTo(org.bukkit.event.player.AsyncPlayerPreLoginEvent.Result.ALLOWED);
    assertThat(pending.isDone()).isFalse();

    pending.complete(false);
  }

  @org.junit.jupiter.api.Test
  void falseIpRolloutBypassesStaffStateReadiness() throws Exception {
    var clients =
        new ForwardedClients(
            new com.shepherdjerred.thestorm.core.expansion.ManagedGameplay(
                (key, actor) -> java.util.concurrent.CompletableFuture.completedFuture(false),
                () -> {},
                true),
            () -> false,
            ip -> java.util.Optional.empty());
    var event = login("127.0.0.1", "127.0.0.1");

    clients.login(event);

    assertThat(event.getLoginResult())
        .isEqualTo(org.bukkit.event.player.AsyncPlayerPreLoginEvent.Result.ALLOWED);
  }

  @org.junit.jupiter.api.Test
  void enabledIpEnforcementRequiresStaffBanState() throws Exception {
    var clients =
        new ForwardedClients(
            new com.shepherdjerred.thestorm.core.expansion.ManagedGameplay(
                (key, actor) -> java.util.concurrent.CompletableFuture.completedFuture(true),
                () -> {},
                true),
            () -> false,
            ip -> java.util.Optional.empty());
    var event = login("10.1.2.3", "8.8.8.8");

    clients.login(event);

    assertThat(event.getLoginResult())
        .isEqualTo(org.bukkit.event.player.AsyncPlayerPreLoginEvent.Result.KICK_OTHER);
    assertThat(event.kickMessage())
        .isEqualTo(
            net.kyori.adventure.text.Component.text(
                "Staff state is still loading. Please retry shortly."));
  }

  @ParameterizedTest
  @ValueSource(
      strings = {
        "10.1.2.3",
        "100.64.1.1",
        "127.0.0.1",
        "169.254.1.1",
        "192.168.1.1",
        "224.0.0.1",
        "999.1.1.1",
        "8.8.8",
        "example.com",
        "::1",
        "::ffff:127.0.0.1",
        "::ffff:100.64.1.1",
        "fc00::1",
        "fe80::1"
      })
  void refusesUnverifiedSharedAndInvalidAddresses(String input) {
    assertThat(ForwardedClients.publicAddress(input)).isEmpty();
  }

  @ParameterizedTest
  @ValueSource(strings = {"2606:4700:4700::1111", "8.8.8.8"})
  void canonicalizesPublicLiterals(String input) {
    assertThat(ForwardedClients.publicAddress(input)).isPresent();
  }
}
