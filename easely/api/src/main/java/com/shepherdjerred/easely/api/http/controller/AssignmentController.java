package com.shepherdjerred.easely.api.http.controller;

import com.shepherdjerred.easely.api.model.Assignment;
import com.shepherdjerred.easely.api.model.User;
import com.shepherdjerred.easely.api.easel.datasource.EaselDataSource;
import lombok.AllArgsConstructor;
import lombok.extern.log4j.Log4j2;

import java.util.Collection;

@Log4j2
@AllArgsConstructor
public class AssignmentController {

    private EaselDataSource easelDataSource;

    public Collection<Assignment> getAssignmentsForUser(User user) {
        return easelDataSource.getUserAssignments(user);
    }
}
