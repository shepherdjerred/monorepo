/** A valid triage request body, fresh per call so tests share no mutation. */
export function triageRequestBody() {
  return {
    ticket: {
      id: 1,
      reporter: "f47ac10b-58cc-4372-a567-0e02b2c3d479",
      categoryId: "grief",
      statusId: "open",
      priorityId: "normal",
      summary: "my wall is gone",
      location: null,
      createdAt: "2017-06-01T12:00:00.000Z",
      updatedAt: "2017-06-01T12:00:00.000Z",
      claimer: null,
      triage: null,
    },
    comments: [],
    reporterHistory: [],
    reporterBanned: false,
    reporterRecentChat: [],
  };
}
