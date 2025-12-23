import { Request, Response, NextFunction } from 'express';
import { Course } from './model';
import { ExpressError } from '../../middleware';
import { CourseResponseLocals } from './types';

interface CreateCourseRequest {
  contentUuid: string;
  termUuid: string;
  section: number;
}

export async function createCourse (req: Request, res: Response, next: NextFunction) {
  let { contentUuid, termUuid, section } = req.body as CreateCourseRequest;
  try {
    let course = await Course.create({
      contentUuid,
      termUuid,
      section
    });
    res.json(course);
  } catch (err) {
    next(new ExpressError(err, 500));
  }
}

export async function readCourse (req: Request, res: Response, next: NextFunction) {
  let { courseParam } = res.locals as CourseResponseLocals;
  res.json(courseParam);
}

export async function readCourses (req: Request, res: Response, next: NextFunction) {
  try {
    let courses = await Course.findAll();
    res.json(courses);
  } catch (err) {
    next(new ExpressError(err, 500));
  }
}

interface UpdateCourseRequest {
  contentUuid: string;
  termUuid: string;
  section: number;
}

export async function updateCourse (req: Request, res: Response, next: NextFunction) {
  // TODO can this line be cleaned up?
  let course = (res.locals as CourseResponseLocals).courseParam as Course;
  let { contentUuid, termUuid, section } = req.body as UpdateCourseRequest;
  if (contentUuid) course.contentUuid = contentUuid;
  if (termUuid) course.termUuid = termUuid;
  if (section) course.section = section;
  try {
    await course.save();
  } catch (err) {
    next(new ExpressError(err, 500));
  }
}

export async function deleteCourse (req: Request, res: Response, next: NextFunction) {
  let course = (res.locals as CourseResponseLocals).courseParam as Course;
  try {
    await course.destroy();
    res.json(course);
  } catch (err) {
    next(new ExpressError(err, 500));
  }
}
