package com.shepherdjerred.thestorm.rwfbots.domain.director;

/** The standard normal distribution, to about seven digits. */
public final class Normal {

  private Normal() {}

  /** The cumulative distribution at {@code x} (Abramowitz and Stegun 7.1.26). */
  public static double cdf(double x) {
    var z = Math.abs(x) / Math.sqrt(2);
    var t = 1 / (1 + 0.3275911 * z);
    var poly =
        t
            * (0.254829592
                + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429))));
    var erf = 1 - poly * Math.exp(-z * z);
    return 0.5 * (1 + (x < 0 ? -erf : erf));
  }

  /** The quantile at probability {@code p} in (0, 1) (Acklam's algorithm). */
  public static double quantile(double p) {
    if (!(p > 0 && p < 1)) {
      throw new IllegalArgumentException("p must be in (0, 1): " + p);
    }
    double[] a = {
      -3.969683028665376e+01,
      2.209460984245205e+02,
      -2.759285104469687e+02,
      1.383577518672690e+02,
      -3.066479806614716e+01,
      2.506628277459239e+00
    };
    double[] b = {
      -5.447609879822406e+01,
      1.615858368580409e+02,
      -1.556989798598866e+02,
      6.680131188771972e+01,
      -1.328068155288572e+01
    };
    double[] c = {
      -7.784894002430293e-03,
      -3.223964580411365e-01,
      -2.400758277161838e+00,
      -2.549732539343734e+00,
      4.374664141464968e+00,
      2.938163982698783e+00
    };
    double[] d = {
      7.784695709041462e-03, 3.224671290700398e-01, 2.445134137142996e+00, 3.754408661907416e+00
    };
    var low = 0.02425;
    if (p < low) {
      var q = Math.sqrt(-2 * Math.log(p));
      return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5])
          / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
    }
    if (p > 1 - low) {
      var q = Math.sqrt(-2 * Math.log(1 - p));
      return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5])
          / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
    }
    var q = p - 0.5;
    var r = q * q;
    return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5])
        * q
        / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
  }
}
