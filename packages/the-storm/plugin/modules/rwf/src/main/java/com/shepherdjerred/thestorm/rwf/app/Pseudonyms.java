package com.shepherdjerred.thestorm.rwf.app;

import java.nio.charset.StandardCharsets;
import java.security.InvalidKeyException;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;
import java.util.UUID;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;

/**
 * Stable pseudonyms for recordings: {@code p} followed by the first {@value #HEX_DIGITS} hex digits
 * of {@code HMAC-SHA256(salt, uuid)}. The salt comes from the environment and is never written to a
 * recording, so recordings can be shared without naming anyone, while the same player keeps the
 * same pseudonym across matches for as long as the salt stands.
 */
public final class Pseudonyms {

  private static final int HEX_DIGITS = 16;
  private static final String ALGORITHM = "HmacSHA256";

  private final SecretKeySpec key;

  public Pseudonyms(String salt) {
    if (salt.isBlank()) {
      throw new IllegalArgumentException("the recording salt must not be blank");
    }
    this.key = new SecretKeySpec(salt.getBytes(StandardCharsets.UTF_8), ALGORITHM);
  }

  public String of(UUID uuid) {
    try {
      var mac = Mac.getInstance(ALGORITHM);
      mac.init(key);
      var digest = mac.doFinal(uuid.toString().getBytes(StandardCharsets.UTF_8));
      return "p" + HexFormat.of().formatHex(digest, 0, HEX_DIGITS / 2);
    } catch (NoSuchAlgorithmException | InvalidKeyException impossible) {
      throw new IllegalStateException(ALGORITHM + " is required by Java", impossible);
    }
  }
}
