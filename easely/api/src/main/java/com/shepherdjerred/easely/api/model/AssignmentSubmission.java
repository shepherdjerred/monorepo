package com.shepherdjerred.easely.api.model;

import lombok.*;

import java.time.LocalDateTime;

@NoArgsConstructor
@AllArgsConstructor
@ToString
public class AssignmentSubmission {
    @Getter
    private String fileName;
    @Getter
    private String currentFile;
    @Getter
    private LocalDateTime currentFileTimestamp;
    @Getter
    private boolean isSubmitted;
}
