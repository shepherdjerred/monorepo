import { Router } from "express";
import { db, schema } from "../db/index.js";
import { eq, and } from "drizzle-orm";
import { generateId, MAX_WATCHES_PER_USER, MAX_WATCH_DATE_RANGE_DAYS, parseDate } from "@camping/shared";

const router = Router();

// Get all watches for a user
router.get("/user/:userId", async (req, res) => {
  try {
    const { userId } = req.params;
    const watches = await db
      .select()
      .from(schema.watches)
      .where(eq(schema.watches.userId, userId));

    res.json({ success: true, data: watches });
  } catch (error) {
    console.error("Error fetching watches:", error);
    res.status(500).json({ success: false, error: "Failed to fetch watches" });
  }
});

// Get a specific watch
router.get("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const watch = await db
      .select()
      .from(schema.watches)
      .where(eq(schema.watches.id, id))
      .limit(1);

    if (watch.length === 0) {
      return res.status(404).json({ success: false, error: "Watch not found" });
    }

    res.json({ success: true, data: watch[0] });
  } catch (error) {
    console.error("Error fetching watch:", error);
    res.status(500).json({ success: false, error: "Failed to fetch watch" });
  }
});

// Create a new watch
router.post("/", async (req, res) => {
  try {
    const {
      userId,
      campgroundId,
      campsiteId,
      startDate,
      endDate,
      minNights = 1,
      flexibleDates = false,
      siteTypes,
      requiresAccessible,
      requiresElectric,
    } = req.body;

    // Validate required fields
    if (!userId || !startDate || !endDate) {
      return res.status(400).json({
        success: false,
        error: "userId, startDate, and endDate are required",
      });
    }

    // Must have either campgroundId or campsiteId
    if (!campgroundId && !campsiteId) {
      return res.status(400).json({
        success: false,
        error: "Either campgroundId or campsiteId is required",
      });
    }

    // Check date range
    const start = parseDate(startDate);
    const end = parseDate(endDate);
    const daysDiff = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));

    if (daysDiff > MAX_WATCH_DATE_RANGE_DAYS) {
      return res.status(400).json({
        success: false,
        error: `Date range cannot exceed ${MAX_WATCH_DATE_RANGE_DAYS} days`,
      });
    }

    if (daysDiff < 0) {
      return res.status(400).json({
        success: false,
        error: "End date must be after start date",
      });
    }

    // Check user watch limit
    const existingWatches = await db
      .select()
      .from(schema.watches)
      .where(and(eq(schema.watches.userId, userId), eq(schema.watches.isActive, true)));

    if (existingWatches.length >= MAX_WATCHES_PER_USER) {
      return res.status(400).json({
        success: false,
        error: `Maximum of ${MAX_WATCHES_PER_USER} active watches per user`,
      });
    }

    const now = new Date().toISOString();
    const newWatch = {
      id: generateId(),
      userId,
      campgroundId: campgroundId || null,
      campsiteId: campsiteId || null,
      startDate,
      endDate,
      minNights,
      flexibleDates,
      siteTypes: siteTypes ? JSON.stringify(siteTypes) : null,
      requiresAccessible: requiresAccessible || null,
      requiresElectric: requiresElectric || null,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    };

    await db.insert(schema.watches).values(newWatch);

    res.json({ success: true, data: newWatch });
  } catch (error) {
    console.error("Error creating watch:", error);
    res.status(500).json({ success: false, error: "Failed to create watch" });
  }
});

// Update a watch
router.patch("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body;

    // Validate watch exists
    const existing = await db
      .select()
      .from(schema.watches)
      .where(eq(schema.watches.id, id))
      .limit(1);

    if (existing.length === 0) {
      return res.status(404).json({ success: false, error: "Watch not found" });
    }

    const now = new Date().toISOString();
    const updateData: Record<string, unknown> = { updatedAt: now };

    // Only allow certain fields to be updated
    const allowedFields = [
      "startDate",
      "endDate",
      "minNights",
      "flexibleDates",
      "siteTypes",
      "requiresAccessible",
      "requiresElectric",
      "isActive",
    ];

    for (const field of allowedFields) {
      if (updates[field] !== undefined) {
        if (field === "siteTypes" && Array.isArray(updates[field])) {
          updateData[field] = JSON.stringify(updates[field]);
        } else {
          updateData[field] = updates[field];
        }
      }
    }

    await db.update(schema.watches).set(updateData).where(eq(schema.watches.id, id));

    const updated = await db
      .select()
      .from(schema.watches)
      .where(eq(schema.watches.id, id))
      .limit(1);

    res.json({ success: true, data: updated[0] });
  } catch (error) {
    console.error("Error updating watch:", error);
    res.status(500).json({ success: false, error: "Failed to update watch" });
  }
});

// Delete a watch
router.delete("/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const existing = await db
      .select()
      .from(schema.watches)
      .where(eq(schema.watches.id, id))
      .limit(1);

    if (existing.length === 0) {
      return res.status(404).json({ success: false, error: "Watch not found" });
    }

    await db.delete(schema.watches).where(eq(schema.watches.id, id));

    res.json({ success: true, message: "Watch deleted" });
  } catch (error) {
    console.error("Error deleting watch:", error);
    res.status(500).json({ success: false, error: "Failed to delete watch" });
  }
});

export default router;
