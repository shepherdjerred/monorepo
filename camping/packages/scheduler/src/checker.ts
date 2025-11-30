import { db, campgrounds, campsites, availability, watches, alerts, users } from "./db.js";
import { eq, and, gte, lte, inArray } from "drizzle-orm";
import {
  RECREATION_GOV_API_BASE,
  retryWithBackoff,
  generateId,
  findConsecutiveAvailability,
  type AvailabilityStatus,
} from "@camping/shared";
import { sendEmailNotification } from "./notifications.js";

const USER_AGENT =
  "CampingNotifier/1.0 (Washington State Campsite Availability Checker)";

interface RecGovAvailability {
  campsites: Record<
    string,
    {
      campsite_id: string;
      site: string;
      loop: string;
      campsite_type: string;
      availabilities: Record<string, string>;
    }
  >;
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, {
    headers: {
      "User-Agent": USER_AGENT,
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  return response.json() as Promise<T>;
}

function mapAvailabilityStatus(status: string): AvailabilityStatus {
  switch (status.toLowerCase()) {
    case "available":
      return "available";
    case "reserved":
      return "reserved";
    case "not reservable":
    case "not available":
      return "not_reservable";
    case "open":
    case "first come first served":
      return "first_come_first_served";
    default:
      return "unknown";
  }
}

/**
 * Fetch availability from Recreation.gov API for a specific month
 */
async function fetchMonthAvailability(
  facilityId: string,
  startDate: Date
): Promise<Map<string, Map<string, AvailabilityStatus>>> {
  const year = startDate.getFullYear();
  const month = String(startDate.getMonth() + 1).padStart(2, "0");
  const url = `${RECREATION_GOV_API_BASE}/camps/availability/campground/${facilityId}/month?start_date=${year}-${month}-01T00:00:00.000Z`;

  try {
    const data = await retryWithBackoff(() =>
      fetchJson<RecGovAvailability>(url)
    );

    const result = new Map<string, Map<string, AvailabilityStatus>>();

    for (const [campsiteId, siteData] of Object.entries(data.campsites)) {
      const dateMap = new Map<string, AvailabilityStatus>();
      for (const [dateStr, status] of Object.entries(siteData.availabilities)) {
        const date = dateStr.split("T")[0];
        dateMap.set(date, mapAvailabilityStatus(status));
      }
      result.set(campsiteId, dateMap);
    }

    return result;
  } catch (error) {
    console.error(`Error fetching availability for facility ${facilityId}:`, error);
    return new Map();
  }
}

/**
 * Check all active watches and generate alerts for new availability
 */
export async function checkWatches(): Promise<void> {
  console.log(`[${new Date().toISOString()}] Starting availability check...`);

  // Get all active watches
  const activeWatches = await db
    .select()
    .from(watches)
    .where(eq(watches.isActive, true));

  console.log(`Found ${activeWatches.length} active watches`);

  // Group watches by campground for efficient API calls
  const watchesByCampground = new Map<string, typeof activeWatches>();

  for (const watch of activeWatches) {
    const campgroundId = watch.campgroundId;
    if (!campgroundId) continue;

    if (!watchesByCampground.has(campgroundId)) {
      watchesByCampground.set(campgroundId, []);
    }
    watchesByCampground.get(campgroundId)!.push(watch);
  }

  // Process each campground
  for (const [campgroundId, campgroundWatches] of watchesByCampground) {
    try {
      // Get campground details
      const campground = await db
        .select()
        .from(campgrounds)
        .where(eq(campgrounds.id, campgroundId))
        .limit(1);

      if (campground.length === 0) {
        console.warn(`Campground ${campgroundId} not found, skipping`);
        continue;
      }

      const facilityId = campground[0].facilityId;
      console.log(`Checking ${campground[0].name} (${facilityId})...`);

      // Determine date range needed (union of all watches)
      let minDate = new Date("9999-12-31");
      let maxDate = new Date("1970-01-01");

      for (const watch of campgroundWatches) {
        const start = new Date(watch.startDate);
        const end = new Date(watch.endDate);
        if (start < minDate) minDate = start;
        if (end > maxDate) maxDate = end;
      }

      // Fetch availability for all needed months
      const allAvailability = new Map<string, Map<string, AvailabilityStatus>>();
      const currentDate = new Date(minDate);
      currentDate.setDate(1); // Start from first of month

      while (currentDate <= maxDate) {
        const monthAvailability = await fetchMonthAvailability(facilityId, currentDate);
        for (const [campsiteId, dateMap] of monthAvailability) {
          if (!allAvailability.has(campsiteId)) {
            allAvailability.set(campsiteId, new Map());
          }
          const existing = allAvailability.get(campsiteId)!;
          for (const [date, status] of dateMap) {
            existing.set(date, status);
          }
        }
        currentDate.setMonth(currentDate.getMonth() + 1);
      }

      // Get campsites for this campground
      const campgroundCampsites = await db
        .select()
        .from(campsites)
        .where(eq(campsites.campgroundId, campgroundId));

      // Update database with new availability
      const checkedAt = new Date().toISOString();
      for (const [campsiteId, dateMap] of allAvailability) {
        for (const [date, status] of dateMap) {
          // Check if record exists
          const existing = await db
            .select()
            .from(availability)
            .where(
              and(
                eq(availability.campsiteId, campsiteId),
                eq(availability.date, date)
              )
            )
            .limit(1);

          if (existing.length > 0) {
            // Update existing
            await db
              .update(availability)
              .set({ status, checkedAt })
              .where(eq(availability.id, existing[0].id));
          } else {
            // Insert new
            await db.insert(availability).values({
              id: generateId(),
              campsiteId,
              date,
              status,
              checkedAt,
            });
          }
        }
      }

      // Check each watch for matching availability
      for (const watch of campgroundWatches) {
        await checkWatchForAvailability(watch, allAvailability, campgroundCampsites, campground[0]);
      }

      // Add delay between campgrounds to be respectful to API
      await new Promise((resolve) => setTimeout(resolve, 2000));
    } catch (error) {
      console.error(`Error processing campground ${campgroundId}:`, error);
    }
  }

  console.log(`[${new Date().toISOString()}] Availability check complete`);
}

async function checkWatchForAvailability(
  watch: typeof watches.$inferSelect,
  allAvailability: Map<string, Map<string, AvailabilityStatus>>,
  campgroundCampsites: (typeof campsites.$inferSelect)[],
  campground: typeof campgrounds.$inferSelect
): Promise<void> {
  const watchSiteTypes = watch.siteTypes ? JSON.parse(watch.siteTypes) : null;

  // Filter campsites based on watch preferences
  let eligibleCampsites = campgroundCampsites;

  if (watchSiteTypes && watchSiteTypes.length > 0) {
    eligibleCampsites = eligibleCampsites.filter((cs) =>
      watchSiteTypes.includes(cs.siteType)
    );
  }

  if (watch.requiresAccessible) {
    eligibleCampsites = eligibleCampsites.filter((cs) => cs.isAccessible);
  }

  if (watch.requiresElectric) {
    eligibleCampsites = eligibleCampsites.filter((cs) => cs.hasElectric);
  }

  // Check each eligible campsite
  for (const campsite of eligibleCampsites) {
    const siteAvailability = allAvailability.get(campsite.id);
    if (!siteAvailability) continue;

    // Find available dates within watch range
    const availableDates: string[] = [];
    let currentDate = new Date(watch.startDate);
    const endDate = new Date(watch.endDate);

    while (currentDate <= endDate) {
      const dateStr = currentDate.toISOString().split("T")[0];
      if (siteAvailability.get(dateStr) === "available") {
        availableDates.push(dateStr);
      }
      currentDate.setDate(currentDate.getDate() + 1);
    }

    if (availableDates.length === 0) continue;

    // Check for consecutive nights if required
    const sequences = findConsecutiveAvailability(availableDates, watch.minNights);

    if (sequences.length === 0) continue;

    // Check if we've already created an alert for this
    const existingAlerts = await db
      .select()
      .from(alerts)
      .where(
        and(
          eq(alerts.watchId, watch.id),
          eq(alerts.campsiteId, campsite.id),
          inArray(alerts.status, ["pending", "sent"])
        )
      );

    // Only create alert if we haven't notified about these exact dates
    const newDates = sequences.flat();
    const shouldCreateAlert = existingAlerts.length === 0 ||
      existingAlerts.every((alert) => {
        const alertDates = JSON.parse(alert.availableDates);
        return !newDates.every((d) => alertDates.includes(d));
      });

    if (shouldCreateAlert) {
      // Get user for notification
      const user = await db
        .select()
        .from(users)
        .where(eq(users.id, watch.userId))
        .limit(1);

      if (user.length === 0) continue;

      // Create alert
      const alertId = generateId();
      await db.insert(alerts).values({
        id: alertId,
        watchId: watch.id,
        userId: watch.userId,
        campsiteId: campsite.id,
        availableDates: JSON.stringify(newDates),
        status: "pending",
        createdAt: new Date().toISOString(),
      });

      console.log(
        `Created alert for ${campsite.name} at ${campground.name}: ${newDates.join(", ")}`
      );

      // Send notification
      const prefs = JSON.parse(user[0].notificationPreferences);
      if (prefs.email && prefs.emailAddress) {
        try {
          await sendEmailNotification({
            to: prefs.emailAddress,
            campgroundName: campground.name,
            campsiteName: campsite.name,
            availableDates: newDates,
            reservationUrl: campground.reservationUrl,
          });

          // Mark alert as sent
          await db
            .update(alerts)
            .set({ status: "sent", sentAt: new Date().toISOString() })
            .where(eq(alerts.id, alertId));

          console.log(`Sent email notification to ${prefs.emailAddress}`);
        } catch (error) {
          console.error("Failed to send email notification:", error);
        }
      }
    }
  }
}
