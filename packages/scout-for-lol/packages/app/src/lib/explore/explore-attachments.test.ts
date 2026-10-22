import { describe, expect, test } from "vitest";
import {
  EXPLORE_IMAGE_MAX_BYTES,
  imageFiles,
  imageRefusal,
} from "#src/lib/explore/explore-attachments.ts";

describe("Explore image intake", () => {
  test("accepts the image types the server reads", () => {
    for (const type of ["image/png", "image/jpeg", "image/webp"])
      expect(imageRefusal({ type, size: 1024 }, 0)).toBeNull();
  });

  test("refuses other types, oversized files and a fifth image", () => {
    expect(imageRefusal({ type: "image/gif", size: 1024 }, 0)).toMatch(
      /PNG, JPEG or WebP/,
    );
    expect(
      imageRefusal({ type: "image/png", size: EXPLORE_IMAGE_MAX_BYTES + 1 }, 0),
    ).toMatch(/10 MiB/);
    expect(imageRefusal({ type: "image/png", size: 1024 }, 4)).toMatch(
      /up to 4/,
    );
  });

  test("keeps only image files from a paste or drop", () => {
    const files = [
      new File(["a"], "a.png", { type: "image/png" }),
      new File(["b"], "notes.txt", { type: "text/plain" }),
    ];
    expect(imageFiles(files).map((file) => file.name)).toEqual(["a.png"]);
  });
});
