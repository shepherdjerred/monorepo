import { isVideo } from "./video.tsx";
import { isCommentary } from "./commentary.tsx";
import { isCourse } from "./course.tsx";

enum Type {
  VIDEO,
  COMMENTARY,
  COURSE,
}

export function getType(input: unknown): Type | undefined {
  if (isVideo(input)) {
    return Type.VIDEO;
  } else if (isCommentary(input)) {
    return Type.COMMENTARY;
  } else if (isCourse(input)) {
    return Type.COURSE;
  } else {
    return undefined;
  }
}

export default Type;
