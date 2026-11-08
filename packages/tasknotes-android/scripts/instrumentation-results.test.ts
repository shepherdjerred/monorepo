import { expect, test } from "vitest";
import { assertInstrumentationSuccess } from "./instrumentation-results";

const identity = "red.sjer.facet.Example#actualJourney";
function status(code: number) {
  return `INSTRUMENTATION_STATUS: class=red.sjer.facet.Example\nINSTRUMENTATION_STATUS: test=actualJourney\nINSTRUMENTATION_STATUS_CODE: ${code}\n`;
}
const finish = "OK (1 test)\nINSTRUMENTATION_CODE: -1\n";
test("requires a matching Android start, success and completed runner", () => {
  expect(() =>
    assertInstrumentationSuccess(status(1) + status(0) + finish, [identity]),
  ).not.toThrow();
});
test.each([-1, -2, -3, -4])(
  "rejects native failure, ignored and assumption statuses: %s",
  (code) => {
    expect(() =>
      assertInstrumentationSuccess(status(1) + status(code) + finish, [
        identity,
      ]),
    ).toThrow();
  },
);
test("counts and names alone cannot pass an unexecuted, duplicate or incomplete journey", () => {
  for (const transcript of [
    finish,
    status(0) + finish,
    status(1) + finish,
    status(1) + status(0),
    status(1) + status(0) + status(0) + finish,
  ])
    expect(() =>
      assertInstrumentationSuccess(transcript, [identity]),
    ).toThrow();
  expect(() =>
    assertInstrumentationSuccess(status(1) + status(0) + finish, [
      "different.Class#actualJourney",
    ]),
  ).toThrow();
});
