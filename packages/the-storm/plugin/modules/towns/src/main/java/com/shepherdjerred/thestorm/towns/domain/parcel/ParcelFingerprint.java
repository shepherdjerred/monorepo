package com.shepherdjerred.thestorm.towns.domain.parcel;

import static java.nio.charset.StandardCharsets.UTF_8;

import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;

/** Geometry changes cannot silently reuse the recovery baseline of an occupied plot. */
public final class ParcelFingerprint {
  private ParcelFingerprint() {}

  public static String of(ParcelDefinition definition) {
    var area = definition.area();
    var geometry =
        definition.id()
            + "\n"
            + definition.kind()
            + "\n"
            + area.world()
            + "\n"
            + area.from().x()
            + ","
            + area.from().y()
            + ","
            + area.from().z()
            + "\n"
            + area.to().x()
            + ","
            + area.to().y()
            + ","
            + area.to().z();
    try {
      return HexFormat.of()
          .formatHex(MessageDigest.getInstance("SHA-256").digest(geometry.getBytes(UTF_8)));
    } catch (NoSuchAlgorithmException e) {
      throw new IllegalStateException("SHA-256 is unavailable", e);
    }
  }
}
