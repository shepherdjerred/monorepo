package com.shepherdjerred.easely.api.model;

import com.shepherdjerred.easely.api.easel.scraper.model.AssignmentCore;
import com.shepherdjerred.easely.api.easel.scraper.model.AssignmentDetails;
import lombok.*;

import java.time.LocalDateTime;

@NoArgsConstructor
@AllArgsConstructor
@ToString
public class Assignment {

    @Getter
    private String id;
    @Getter
    private String name;
    @Getter
    private LocalDateTime date;
    @Getter
    private int number;
    @Getter
    private Type type;
    @Getter
    private Course course;
    @Getter
    private String attachment;

    public static Assignment fromSubObjects(AssignmentCore assignmentCore, AssignmentDetails assignmentDetails) {
        return new Assignment(assignmentCore.getId(),
                assignmentCore.getName(),
                assignmentCore.getDate().atTime(assignmentDetails.getDueTime()),
                assignmentCore.getNumber(),
                assignmentCore.getType(),
                assignmentCore.getCourse(),
                assignmentDetails.getAttachment());
    }

    public enum Type {
        HOMEWORK,
        NOTES,
        PROJECT,
        EXAM,
        FINAL
    }
}
