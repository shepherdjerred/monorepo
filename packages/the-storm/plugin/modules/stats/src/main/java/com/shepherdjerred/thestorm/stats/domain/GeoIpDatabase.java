package com.shepherdjerred.thestorm.stats.domain;

import java.io.BufferedInputStream;
import java.io.DataInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.InetAddress;
import java.util.Locale;
import java.util.Optional;
import java.util.concurrent.ConcurrentHashMap;
import java.util.zip.GZIPInputStream;
import org.jspecify.annotations.Nullable;

/**
 * Privacy-preserving in-memory country resolver backed by compiled Regional Internet Registry
 * allocation intervals ({@code /geoip-rir.bin.gz}). Never performs network I/O or persists raw IP
 * addresses.
 */
public final class GeoIpDatabase {

  public static final String BUNDLED_RESOURCE = "/geoip-rir.bin.gz";

  private static final int MAGIC_SGEO = 0x5347_454F;
  private static final int FORMAT_VERSION = 1;
  private static final int MAX_RANGES = 2_000_000;
  private static final int MAX_COUNTRY_NAME_LENGTH = 80;

  private final Ipv4Table ipv4;
  private final Ipv6Table ipv6;
  private final ConcurrentHashMap<Integer, Country> countryCache = new ConcurrentHashMap<>(256);

  private GeoIpDatabase(Ipv4Table ipv4, Ipv6Table ipv6) {
    this.ipv4 = ipv4;
    this.ipv6 = ipv6;
  }

  public record Country(String code, String name) {
    public Country {
      if (code.length() != 2
          || !isUpperAsciiLetter(code.charAt(0))
          || !isUpperAsciiLetter(code.charAt(1))) {
        throw new IllegalArgumentException("Invalid ISO-3166-1 country code: " + code);
      }
      var stripped = name.strip();
      if (stripped.isEmpty()) {
        stripped = code;
      }
      name =
          stripped.length() > MAX_COUNTRY_NAME_LENGTH
              ? stripped.substring(0, MAX_COUNTRY_NAME_LENGTH)
              : stripped;
    }
  }

  private static final class Ipv4Table {
    final int[] starts;
    final int[] ends;
    final short[] countries;

    Ipv4Table(int[] starts, int[] ends, short[] countries) {
      this.starts = starts;
      this.ends = ends;
      this.countries = countries;
    }
  }

  private static final class Ipv6Table {
    final long[] starts;
    final long[] ends;
    final short[] countries;

    Ipv6Table(long[] starts, long[] ends, short[] countries) {
      this.starts = starts;
      this.ends = ends;
      this.countries = countries;
    }
  }

  private static final class BundledHolder {
    static final GeoIpDatabase INSTANCE = loadBundled();
  }

  /** Returns the shared JVM-wide bundled RIR GeoIP database, loading it once on first access. */
  public static GeoIpDatabase bundled() {
    return BundledHolder.INSTANCE;
  }

  /** Loads {@code /geoip-rir.bin.gz} from the module classpath, failing loudly if missing/bad. */
  public static GeoIpDatabase loadBundled() {
    var stream = GeoIpDatabase.class.getResourceAsStream(BUNDLED_RESOURCE);
    if (stream == null) {
      throw new IllegalStateException("Missing bundled GeoIP resource: " + BUNDLED_RESOURCE);
    }
    try (var raw = stream) {
      return loadGzipped(raw);
    } catch (IOException e) {
      throw new IllegalStateException(
          "Failed to read bundled GeoIP resource: " + BUNDLED_RESOURCE, e);
    }
  }

  /** Loads a gzipped {@code SGEO} v1 binary stream, failing loudly on malformed or corrupt data. */
  public static GeoIpDatabase loadGzipped(InputStream gzippedStream) {
    try (var gzip = new GZIPInputStream(new BufferedInputStream(gzippedStream));
        var in = new DataInputStream(new BufferedInputStream(gzip))) {
      int magic = in.readInt();
      if (magic != MAGIC_SGEO) {
        throw new IllegalStateException(
            "Invalid GeoIP magic header: 0x" + Integer.toHexString(magic));
      }
      int version = in.readInt();
      if (version != FORMAT_VERSION) {
        throw new IllegalStateException("Unsupported GeoIP format version: " + version);
      }
      int ipv4Count = in.readInt();
      int ipv6Count = in.readInt();
      if (ipv4Count < 0 || ipv4Count > MAX_RANGES || ipv6Count < 0 || ipv6Count > MAX_RANGES) {
        throw new IllegalStateException(
            "Out-of-bounds GeoIP table counts: ipv4=" + ipv4Count + ", ipv6=" + ipv6Count);
      }
      var ipv4Table = readIpv4Table(in, ipv4Count);
      var ipv6Table = readIpv6Table(in, ipv6Count);
      if (in.read() != -1) {
        throw new IllegalStateException("Unexpected trailing bytes in GeoIP resource");
      }
      return new GeoIpDatabase(ipv4Table, ipv6Table);
    } catch (IOException e) {
      throw new IllegalStateException("Corrupt GeoIP binary stream", e);
    }
  }

  public static GeoIpDatabase empty() {
    return new GeoIpDatabase(
        new Ipv4Table(new int[0], new int[0], new short[0]),
        new Ipv6Table(new long[0], new long[0], new short[0]));
  }

  public int ipv4RangeCount() {
    return ipv4.starts.length;
  }

  public int ipv6RangeCount() {
    return ipv6.starts.length;
  }

  public Optional<Country> lookup(@Nullable InetAddress address) {
    if (address == null || isNonPublicAddress(address)) {
      return Optional.empty();
    }
    var raw = address.getAddress();
    if (raw.length == 4) {
      return lookupIpv4(packIpv4(raw, 0));
    }
    if (raw.length == 16) {
      if (isIpv4Mapped(raw)) {
        return lookupIpv4(packIpv4(raw, 12));
      }
      return lookupIpv6(packHigh64(raw));
    }
    return Optional.empty();
  }

  private Optional<Country> lookupIpv4(int ip) {
    if (isReservedIpv4(ip)) {
      return Optional.empty();
    }
    var starts = ipv4.starts;
    int low = 0;
    int high = starts.length - 1;
    int candidate = -1;
    while (low <= high) {
      int mid = (low + high) >>> 1;
      if (Integer.compareUnsigned(starts[mid], ip) <= 0) {
        candidate = mid;
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }
    if (candidate < 0 || Integer.compareUnsigned(ip, ipv4.ends[candidate]) > 0) {
      return Optional.empty();
    }
    return Optional.of(resolveCountry(Short.toUnsignedInt(ipv4.countries[candidate])));
  }

  private Optional<Country> lookupIpv6(long high64) {
    if (isReservedIpv6(high64)) {
      return Optional.empty();
    }
    var starts = ipv6.starts;
    int low = 0;
    int high = starts.length - 1;
    int candidate = -1;
    while (low <= high) {
      int mid = (low + high) >>> 1;
      if (Long.compareUnsigned(starts[mid], high64) <= 0) {
        candidate = mid;
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }
    if (candidate < 0 || Long.compareUnsigned(high64, ipv6.ends[candidate]) > 0) {
      return Optional.empty();
    }
    return Optional.of(resolveCountry(Short.toUnsignedInt(ipv6.countries[candidate])));
  }

  private Country resolveCountry(int ccAscii) {
    return countryCache.computeIfAbsent(ccAscii, GeoIpDatabase::buildCountry);
  }

  private static Country buildCountry(int ccAscii) {
    char c0 = (char) ((ccAscii >>> 8) & 0xFF);
    char c1 = (char) (ccAscii & 0xFF);
    var code = new String(new char[] {c0, c1});
    var display = Locale.of("", code).getDisplayCountry(Locale.ENGLISH);
    return new Country(code, display.isBlank() ? code : display);
  }

  private static Ipv4Table readIpv4Table(DataInputStream in, int count) throws IOException {
    var starts = new int[count];
    var ends = new int[count];
    var countries = new short[count];
    for (int i = 0; i < count; i++) {
      int start = in.readInt();
      int end = in.readInt();
      int cc = in.readUnsignedShort();
      validateCountryAscii(cc);
      if (Integer.compareUnsigned(start, end) > 0
          || (i > 0 && Integer.compareUnsigned(ends[i - 1], start) >= 0)) {
        throw new IllegalStateException("Unsorted or overlapping IPv4 range at index " + i);
      }
      starts[i] = start;
      ends[i] = end;
      countries[i] = (short) cc;
    }
    return new Ipv4Table(starts, ends, countries);
  }

  private static Ipv6Table readIpv6Table(DataInputStream in, int count) throws IOException {
    var starts = new long[count];
    var ends = new long[count];
    var countries = new short[count];
    for (int i = 0; i < count; i++) {
      long start = in.readLong();
      long end = in.readLong();
      int cc = in.readUnsignedShort();
      validateCountryAscii(cc);
      if (Long.compareUnsigned(start, end) > 0
          || (i > 0 && Long.compareUnsigned(ends[i - 1], start) >= 0)) {
        throw new IllegalStateException("Unsorted or overlapping IPv6 range at index " + i);
      }
      starts[i] = start;
      ends[i] = end;
      countries[i] = (short) cc;
    }
    return new Ipv6Table(starts, ends, countries);
  }

  private static void validateCountryAscii(int cc) {
    char c0 = (char) ((cc >>> 8) & 0xFF);
    char c1 = (char) (cc & 0xFF);
    if (!isUpperAsciiLetter(c0) || !isUpperAsciiLetter(c1)) {
      throw new IllegalStateException(
          "Invalid packed ISO country code: 0x" + Integer.toHexString(cc));
    }
  }

  private static boolean isUpperAsciiLetter(char ch) {
    return ch >= 'A' && ch <= 'Z';
  }

  private static boolean isNonPublicAddress(InetAddress address) {
    return address.isAnyLocalAddress()
        || address.isLoopbackAddress()
        || address.isLinkLocalAddress()
        || address.isSiteLocalAddress()
        || address.isMulticastAddress();
  }

  private static boolean isIpv4Mapped(byte[] raw) {
    for (int i = 0; i < 10; i++) {
      if (raw[i] != 0) {
        return false;
      }
    }
    return raw[10] == (byte) 0xFF && raw[11] == (byte) 0xFF;
  }

  private static int packIpv4(byte[] raw, int offset) {
    return (Byte.toUnsignedInt(raw[offset]) << 24)
        | (Byte.toUnsignedInt(raw[offset + 1]) << 16)
        | (Byte.toUnsignedInt(raw[offset + 2]) << 8)
        | Byte.toUnsignedInt(raw[offset + 3]);
  }

  private static long packHigh64(byte[] raw) {
    return (Byte.toUnsignedLong(raw[0]) << 56)
        | (Byte.toUnsignedLong(raw[1]) << 48)
        | (Byte.toUnsignedLong(raw[2]) << 40)
        | (Byte.toUnsignedLong(raw[3]) << 32)
        | (Byte.toUnsignedLong(raw[4]) << 24)
        | (Byte.toUnsignedLong(raw[5]) << 16)
        | (Byte.toUnsignedLong(raw[6]) << 8)
        | Byte.toUnsignedLong(raw[7]);
  }

  private static boolean isReservedIpv4(int ip) {
    return isPrivateOrSharedIpv4(ip) || isSpecialOrDocumentationIpv4(ip);
  }

  private static boolean isPrivateOrSharedIpv4(int ip) {
    int firstOctet = ip >>> 24;
    return firstOctet == 0 // 0.0.0.0/8 ("this network")
        || firstOctet == 10 // 10.0.0.0/8 (RFC 1918)
        || firstOctet == 127 // 127.0.0.0/8 (loopback)
        || (ip & 0xFFC0_0000) == 0x6440_0000 // 100.64.0.0/10 (RFC 6598 CGNAT / Tailscale)
        || (ip & 0xFFFF_0000) == 0xA9FE_0000 // 169.254.0.0/16 (link-local)
        || (ip & 0xFFF0_0000) == 0xAC10_0000 // 172.16.0.0/12 (RFC 1918)
        || (ip & 0xFFFF_0000) == 0xC0A8_0000; // 192.168.0.0/16 (RFC 1918)
  }

  private static boolean isSpecialOrDocumentationIpv4(int ip) {
    return (ip & 0xFFFF_FF00) == 0xC000_0000 // 192.0.0.0/24 (IETF protocol assignments)
        || (ip & 0xFFFF_FF00) == 0xC000_0200 // 192.0.2.0/24 (TEST-NET-1)
        || (ip & 0xFFFE_0000) == 0xC612_0000 // 198.18.0.0/15 (benchmarking)
        || (ip & 0xFFFF_FF00) == 0xC633_6400 // 198.51.100.0/24 (TEST-NET-2)
        || (ip & 0xFFFF_FF00) == 0xCB00_7100 // 203.0.113.0/24 (TEST-NET-3)
        || (ip & 0xE000_0000) == 0xE000_0000; // 224.0.0.0/4 multicast + 240.0.0.0/4 reserved
  }

  private static boolean isReservedIpv6(long high64) {
    return (high64 >>> 56) == 0L // ::/8 (unspecified, loopback, IPv4-compatible)
        || high64 == 0x0100_0000_0000_0000L // 100::/64 (discard-only)
        || (high64 & 0xFFFF_FFFF_0000_0000L) == 0x2001_0DB8_0000_0000L // 2001:db8::/32 (docs)
        || (high64 & 0xFE00_0000_0000_0000L) == 0xFC00_0000_0000_0000L // fc00::/7 (unique-local)
        || (high64 & 0xFFC0_0000_0000_0000L) == 0xFE80_0000_0000_0000L // fe80::/10 (link-local)
        || (high64 & 0xFF00_0000_0000_0000L) == 0xFF00_0000_0000_0000L; // ff00::/8 (multicast)
  }
}
