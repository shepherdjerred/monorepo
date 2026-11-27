package com.shepherdjerred.thestorm.stats.domain;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.DataOutputStream;
import java.net.Inet6Address;
import java.net.InetAddress;
import java.util.List;
import java.util.zip.GZIPOutputStream;
import org.junit.jupiter.api.Test;

final class GeoIpDatabaseTest {

  @Test
  void resolvesPublicIpv4Ipv6AndMappedAddressesFromBundledRirTable() throws Exception {
    var geo = GeoIpDatabase.bundled();
    assertThat(GeoIpDatabase.bundled()).isSameAs(geo);
    assertThat(geo.ipv4RangeCount()).isGreaterThan(50_000);
    assertThat(geo.ipv6RangeCount()).isGreaterThan(30_000);

    assertThat(geo.lookup(InetAddress.ofLiteral("8.8.8.8")))
        .contains(new GeoIpDatabase.Country("US", "United States"));
    assertThat(geo.lookup(InetAddress.ofLiteral("1.1.1.1")))
        .contains(new GeoIpDatabase.Country("AU", "Australia"));
    assertThat(geo.lookup(InetAddress.ofLiteral("2606:4700:4700::1111")))
        .contains(new GeoIpDatabase.Country("US", "United States"));
    assertThat(geo.lookup(InetAddress.ofLiteral("::ffff:8.8.8.8")))
        .contains(new GeoIpDatabase.Country("US", "United States"));

    // Explicit 16-byte Inet6Address with IPv4-mapped prefix ::ffff:8.8.8.8
    var mappedBytes =
        new byte[] {
          0, 0, 0, 0, 0, 0, 0, 0, 0, 0, (byte) 0xFF, (byte) 0xFF, 8, 8, 8, 8,
        };
    var mappedIpv6 = Inet6Address.getByAddress(null, mappedBytes, -1);
    assertThat(geo.lookup(mappedIpv6)).contains(new GeoIpDatabase.Country("US", "United States"));
  }

  @Test
  void ignoresNullPrivateLoopbackTailscaleCgnatAndDocumentationAddresses() throws Exception {
    var geo = GeoIpDatabase.bundled();
    assertThat(geo.lookup(null)).isEmpty();

    var nonPublicLiterals =
        List.of(
            "0.0.0.0",
            "127.0.0.1",
            "10.0.0.1",
            "10.42.0.5",
            "172.16.0.1",
            "172.31.255.254",
            "192.168.1.1",
            "169.254.10.20",
            "100.64.0.1",
            "100.96.247.28",
            "100.127.255.254",
            "192.0.0.1",
            "192.0.2.1",
            "198.18.0.1",
            "198.51.100.1",
            "203.0.113.1",
            "224.0.0.1",
            "240.0.0.1",
            "255.255.255.255",
            "::",
            "::1",
            "fe80::1",
            "fc00::1",
            "fd00::1",
            "2001:db8::1",
            "ff02::1");
    for (var literal : nonPublicLiterals) {
      assertThat(geo.lookup(InetAddress.ofLiteral(literal)))
          .as("Expected non-public literal %s to resolve empty", literal)
          .isEmpty();
    }

    // Raw 16-byte IPv4-mapped Tailscale CGNAT address ::ffff:100.96.247.28
    var mappedTailscale =
        Inet6Address.getByAddress(
            null,
            new byte[] {
              0, 0, 0, 0, 0, 0, 0, 0, 0, 0, (byte) 0xFF, (byte) 0xFF, 100, 96, (byte) 247, 28,
            },
            -1);
    assertThat(geo.lookup(mappedTailscale)).isEmpty();
  }

  @Test
  void emptyDatabaseReturnsEmptyAndCorruptStreamsFailLoudly() throws Exception {
    assertThat(GeoIpDatabase.empty().lookup(InetAddress.ofLiteral("8.8.8.8"))).isEmpty();

    assertThatThrownBy(
            () -> GeoIpDatabase.loadGzipped(new ByteArrayInputStream(new byte[] {1, 2, 3})))
        .isInstanceOf(IllegalStateException.class);

    var badMagicBytes = new ByteArrayOutputStream();
    try (var gz = new GZIPOutputStream(badMagicBytes);
        var out = new DataOutputStream(gz)) {
      out.writeInt(0x1234_5678);
      out.writeInt(1);
      out.writeInt(0);
      out.writeInt(0);
    }
    assertThatThrownBy(
            () -> GeoIpDatabase.loadGzipped(new ByteArrayInputStream(badMagicBytes.toByteArray())))
        .isInstanceOf(IllegalStateException.class)
        .hasMessageContaining("Invalid GeoIP magic header");
  }
}
