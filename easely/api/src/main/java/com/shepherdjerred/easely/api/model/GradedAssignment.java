package com.shepherdjerred.easely.api.model;

import com.shepherdjerred.easely.api.easel.scraper.model.AssignmentCore;
import com.shepherdjerred.easely.api.easel.scraper.model.AssignmentDetails;
import com.shepherdjerred.easely.api.easel.scraper.model.UserAssignmentGrade;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.ToString;

import java.time.LocalDateTime;
import java.util.Collection;

@NoArgsConstructor
@ToString
public class GradedAssignment extends Assignment {
    @Getter
    private int possiblePoints;
    @Getter
    private int earnedPoints;
    @Getter
    private boolean isGraded;
    @Getter
    private Collection<AssignmentSubmission> assignmentSubmissions;

    public GradedAssignment(String id, String name, LocalDateTime date, int number, Type type, Course course, String attachment, int possiblePoints, int earnedPoints, boolean isGraded, Collection<AssignmentSubmission> assignmentSubmissions) {
        super(id, name, date, number, type, course, attachment);
        this.possiblePoints = possiblePoints;
        this.earnedPoints = earnedPoints;
        this.isGraded = isGraded;
        this.assignmentSubmissions = assignmentSubmissions;
    }

    public static GradedAssignment fromSubObjects(AssignmentCore assignmentCore, AssignmentDetails assignmentDetails, UserAssignmentGrade userAssignmentGrade) {
        return new GradedAssignment(assignmentCore.getId(),
                assignmentCore.getName(),
                assignmentCore.getDate().atTime(assignmentDetails.getDueTime()),
                assignmentCore.getNumber(),
                assignmentCore.getType(),
                assignmentCore.getCourse(),
                assignmentDetails.getAttachment(),
                userAssignmentGrade.getPossiblePoints(),
                userAssignmentGrade.getEarnedPoints(),
                userAssignmentGrade.isGraded(),
                userAssignmentGrade.getAssignmentSubmissions());
    }
}
