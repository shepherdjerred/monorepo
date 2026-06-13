import { Course } from "../schema/schema";

export function isWorldOfWarcraftCommentaryCourse(course: Course): boolean {
  const commentaryCourses = [
    "ROGUE ARENA GUIDES",
    "MAGE ARENA GUIDES",
    "DISC PRIEST ARENA GUIDES",
    "HOLY PRIEST ARENA GUIDES",
    "WARRIOR ARENA GUIDES",
    "WARLOCK ARENA GUIDES",
    "HUNTER ARENA GUIDES",
    "DEATH KNIGHT ARENA GUIDES",
    "DEMON HUNTER ARENA GUIDES",
    "RESTO DRUID ARENA GUIDES",
    "HOLY PALADIN ARENA GUIDES",
    "RESTO SHAMAN ARENA GUIDES",
    "MISTWEAVER MONK ARENA GUIDES",
    "RET PALADIN ARENA GUIDES",
    "FERAL DRUID ARENA GUIDES",
    "ENH SHAMAN ARENA GUIDES",
    "WINDWALKER MONK ARENA GUIDES",
    "SHADOW PRIEST ARENA GUIDES",
    "ELE SHAMAN ARENA GUIDES",
    "BALANCE DRUID ARENA GUIDES",
  ];
  return commentaryCourses.includes(course.title);
}

export function isValorantCommentaryCourse(course: Course): boolean {
  const commentaryCourses: string[] = [];
  return commentaryCourses.includes(course.title);
}
