export function recurrenceDisplayName(recurrence: string): string {
  switch (recurrence) {
    case "FREQ=DAILY":
      return "Daily";
    case "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR":
      return "Weekdays";
    case "FREQ=WEEKLY":
      return "Weekly";
    case "FREQ=MONTHLY":
      return "Monthly";
    case "FREQ=YEARLY":
      return "Yearly";
    case "FREQ=WEEKLY;BYDAY=SU":
      return "Every Sunday";
    case "FREQ=WEEKLY;BYDAY=MO":
      return "Every Monday";
    case "FREQ=WEEKLY;BYDAY=TU":
      return "Every Tuesday";
    case "FREQ=WEEKLY;BYDAY=WE":
      return "Every Wednesday";
    case "FREQ=WEEKLY;BYDAY=TH":
      return "Every Thursday";
    case "FREQ=WEEKLY;BYDAY=FR":
      return "Every Friday";
    case "FREQ=WEEKLY;BYDAY=SA":
      return "Every Saturday";
    default:
      return recurrence;
  }
}
