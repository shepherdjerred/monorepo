package com.shepherdjerred.thestorm.rwfbots.domain.director;

/**
 * A skill estimate on the OpenSkill scale: mean 25, deviation 25/3 for a newcomer.
 *
 * @param mu the estimated skill
 * @param sigma how unsure the estimate is
 */
public record Rating(double mu, double sigma) {

  public static final Rating DEFAULT = new Rating(25, 25.0 / 3);

  public Rating {
    if (!Double.isFinite(mu) || !(sigma > 0) || !Double.isFinite(sigma)) {
      throw new IllegalArgumentException("mu must be finite and sigma positive");
    }
  }

  /** A conservative single number for sorting: three deviations under the mean. */
  public double ordinal() {
    return mu - 3 * sigma;
  }
}
