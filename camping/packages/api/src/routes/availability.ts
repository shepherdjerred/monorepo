import { Router } from "express";
import { db, schema } from "../db/index.js";
import { eq, and, gte, lte, inArray } from "drizzle-orm";
import { getAvailability } from "../services/recreation-gov.js";
import { generateId, getDateRange, findConsecutiveAvailability } from "@camping/shared";

const router = Router();

// Get availability for a campground
router.get("/campground/:campgroundId", async (req, res) => {
  try {
    const { campgroundId } = req.params;
    const { startDate, endDate } = req.query;

    if (!startDate || !endDate) {
      return res.status(400).json({
        success: false,
        error: "startDate and endDate query params are required",
      });
    }

    // Get campsites for this campground
    const campsites = await db
      .select()
      .from(schema.campsites)
      .where(eq(schema.campsites.campgroundId, campgroundId));

    if (campsites.length === 0) {
      return res.status(404).json({
        success: false,
        error: "No campsites found for this campground",
      });
    }

    const campsiteIds = campsites.map((c) => c.id);

    // Get cached availability from database
    const availability = await db
      .select()
      .from(schema.availability)
      .where(
        and(
          inArray(schema.availability.campsiteId, campsiteIds),
          gte(schema.availability.date, startDate as string),
          lte(schema.availability.date, endDate as string)
        )
      );

    res.json({ success: true, data: availability });
  } catch (error) {
    console.error("Error fetching availability:", error);
    res.status(500).json({ success: false, error: "Failed to fetch availability" });
  }
});

// Refresh availability from Recreation.gov API
router.post("/refresh/:facilityId", async (req, res) => {
  try {
    const { facilityId } = req.params;
    const { months = 3 } = req.body;

    // Get campground from database
    const campground = await db
      .select()
      .from(schema.campgrounds)
      .where(eq(schema.campgrounds.facilityId, facilityId))
      .limit(1);

    if (campground.length === 0) {
      return res.status(404).json({
        success: false,
        error: "Campground not found. Import it first.",
      });
    }

    // Fetch availability for the next N months
    const allAvailability = [];
    const startDate = new Date();

    for (let i = 0; i < months; i++) {
      const checkDate = new Date(startDate);
      checkDate.setMonth(checkDate.getMonth() + i);

      const monthAvailability = await getAvailability(facilityId, checkDate);
      allAvailability.push(...monthAvailability);
    }

    // Update database with new availability data
    if (allAvailability.length > 0) {
      // Delete existing availability for these campsites and dates
      const campsiteIds = [...new Set(allAvailability.map((a) => a.campsiteId))];
      const dates = [...new Set(allAvailability.map((a) => a.date))];

      if (campsiteIds.length > 0 && dates.length > 0) {
        const minDate = dates.sort()[0];
        const maxDate = dates.sort().reverse()[0];

        // Delete old records
        await db
          .delete(schema.availability)
          .where(
            and(
              inArray(schema.availability.campsiteId, campsiteIds),
              gte(schema.availability.date, minDate),
              lte(schema.availability.date, maxDate)
            )
          );

        // Insert new records
        const records = allAvailability.map((a) => ({
          id: generateId(),
          ...a,
        }));
        await db.insert(schema.availability).values(records);
      }
    }

    res.json({
      success: true,
      data: {
        recordsUpdated: allAvailability.length,
        monthsChecked: months,
      },
    });
  } catch (error) {
    console.error("Error refreshing availability:", error);
    res.status(500).json({ success: false, error: "Failed to refresh availability" });
  }
});

// Search for available consecutive nights
router.get("/search", async (req, res) => {
  try {
    const { campgroundId, startDate, endDate, minNights = "1" } = req.query;

    if (!campgroundId || !startDate || !endDate) {
      return res.status(400).json({
        success: false,
        error: "campgroundId, startDate, and endDate are required",
      });
    }

    // Get campsites for this campground
    const campsites = await db
      .select()
      .from(schema.campsites)
      .where(eq(schema.campsites.campgroundId, campgroundId as string));

    const campsiteIds = campsites.map((c) => c.id);

    // Get availability
    const availability = await db
      .select()
      .from(schema.availability)
      .where(
        and(
          inArray(schema.availability.campsiteId, campsiteIds),
          gte(schema.availability.date, startDate as string),
          lte(schema.availability.date, endDate as string),
          eq(schema.availability.status, "available")
        )
      );

    // Group by campsite
    const byCampsite = new Map<string, string[]>();
    for (const avail of availability) {
      if (!byCampsite.has(avail.campsiteId)) {
        byCampsite.set(avail.campsiteId, []);
      }
      byCampsite.get(avail.campsiteId)!.push(avail.date);
    }

    // Find consecutive availability for each campsite
    const results = [];
    for (const [campsiteId, dates] of byCampsite) {
      const campsite = campsites.find((c) => c.id === campsiteId);
      const sequences = findConsecutiveAvailability(dates, parseInt(minNights as string));

      if (sequences.length > 0) {
        results.push({
          campsite,
          availableSequences: sequences,
        });
      }
    }

    res.json({ success: true, data: results });
  } catch (error) {
    console.error("Error searching availability:", error);
    res.status(500).json({ success: false, error: "Failed to search availability" });
  }
});

export default router;
