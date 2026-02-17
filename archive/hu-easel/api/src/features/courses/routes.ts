import { Router } from "express";
import contentsRouter from "./contents/routes";
import listingRouter from "./listings/routes";
import { UserRole } from "../users/model";
import { authenticate } from "../users/authentication/middleware";
import { checkUserIsAuthorized } from "../users/authorization/middleware";
import { validateCreateCourseRequest } from "./validator";
import {
  createCourse,
  deleteCourse,
  readCourse,
  readCourses,
  updateCourse,
} from "./controller";
import { getCourseFromParameter } from "./middleware";

const { PROFESSOR, STUDENT } = UserRole;

let router = Router();

router.use("/contents", contentsRouter);
router.use("/listings", listingRouter);

router.param("course_uuid", getCourseFromParameter);

router.post(
  "/",
  authenticate(true),
  checkUserIsAuthorized(PROFESSOR, "CREATE", "COURSE/*"),
  validateCreateCourseRequest,
  createCourse,
);

router.get(
  "/:course_uuid",
  authenticate(true),
  checkUserIsAuthorized(STUDENT, "READ", "COURSE/*"),
  readCourse,
);

router.get(
  "/",
  authenticate(true),
  checkUserIsAuthorized(STUDENT, "READ", "COURSE/*"),
  readCourses,
);

router.put(
  "/:course_uuid",
  authenticate(true),
  checkUserIsAuthorized(PROFESSOR, "UPDATE", "COURSE/*"),
  updateCourse,
);

router.delete(
  "/:course_uuid",
  authenticate(true),
  checkUserIsAuthorized(PROFESSOR, "DELETE", "COURSE/*"),
  deleteCourse,
);

export default router;
