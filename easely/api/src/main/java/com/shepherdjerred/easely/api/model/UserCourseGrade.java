package com.shepherdjerred.easely.api.model;

import lombok.*;

@NoArgsConstructor
@AllArgsConstructor
@ToString
public class UserCourseGrade {
    @Getter
    private double homeworkWeight;
    @Getter
    private double projectWeight;
    @Getter
    private double examWeight;
    @Getter
    private double finalWeight;
    @Getter
    private double classAverage;
}
