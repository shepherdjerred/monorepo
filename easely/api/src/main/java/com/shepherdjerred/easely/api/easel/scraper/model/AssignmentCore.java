package com.shepherdjerred.easely.api.easel.scraper.model;

import com.shepherdjerred.easely.api.model.Assignment;
import com.shepherdjerred.easely.api.model.Course;
import lombok.*;

import java.time.LocalDate;

@NoArgsConstructor
@AllArgsConstructor
@ToString
public class AssignmentCore {
    @Getter
    private String id;
    @Getter
    private String name;
    @Getter
    private LocalDate date;
    @Getter
    private int number;
    @Getter
    private Assignment.Type type;
    @Getter
    private Course course;
}
