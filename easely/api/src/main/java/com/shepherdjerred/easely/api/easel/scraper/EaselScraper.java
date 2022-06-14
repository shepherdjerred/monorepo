package com.shepherdjerred.easely.api.easel.scraper;

import com.shepherdjerred.easely.api.model.Assignment;
import com.shepherdjerred.easely.api.model.Course;
import com.shepherdjerred.easely.api.model.User;

import java.util.Collection;

public interface EaselScraper {

    Collection<Course> scrapeUserCourse(User user);

    Collection<Assignment> scrapeUserAssignments(User user);

}
