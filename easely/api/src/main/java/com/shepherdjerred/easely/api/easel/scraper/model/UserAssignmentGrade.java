package com.shepherdjerred.easely.api.easel.scraper.model;

import com.shepherdjerred.easely.api.model.AssignmentSubmission;
import lombok.*;

import java.util.Collection;

@NoArgsConstructor
@AllArgsConstructor
@ToString
public class UserAssignmentGrade {
    @Getter
    private int possiblePoints;
    @Getter
    private int earnedPoints;
    @Getter
    private boolean isGraded;
    @Getter
    private Collection<AssignmentSubmission> assignmentSubmissions;
}
