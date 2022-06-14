package com.shepherdjerred.easely.api.easel.cache;

import com.shepherdjerred.easely.api.easel.scraper.EaselScraper;
import com.shepherdjerred.easely.api.model.Assignment;
import com.shepherdjerred.easely.api.model.Course;
import com.shepherdjerred.easely.api.model.User;
import lombok.AllArgsConstructor;
import lombok.extern.log4j.Log4j2;

import java.util.Collection;

@Log4j2
@AllArgsConstructor
public class ScraperLoader implements Loader {

    private EaselScraper easelScraper;

    @Override
    public Collection<Course> getUserCourses(User user) {
        return easelScraper.scrapeUserCourse(user);
    }

    @Override
    public Collection<Assignment> getUserAssignments(User user) {
        return easelScraper.scrapeUserAssignments(user);
    }
}
