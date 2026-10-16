package com.shepherdjerred.thestorm.core.safety;

import java.time.Instant;

/** A bounded request; the main-thread owner must reject it after its deadline. */
public record ContentPenalty(
    ContentSubmission submission, ContentReview review, Instant deadline) {}
