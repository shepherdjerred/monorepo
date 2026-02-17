import { isVideo } from "./video";
import { isCommentary } from "./commentary";
import { isCourse } from "./course";

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
