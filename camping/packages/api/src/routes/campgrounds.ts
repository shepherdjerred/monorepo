import { Router } from "express";
import { db, schema } from "../db/index.js";
import { eq, like, and } from "drizzle-orm";
import {
  searchCampgrounds,
  getFacilityDetails,
  getCampsites,
} from "../services/recreation-gov.js";
import { generateId } from "@camping/shared";

const router = Router();

// Search campgrounds (from Recreation.gov API)
router.get("/search", async (req, res) => {
  try {
    const query = (req.query.q as string) || "";
    const state = (req.query.state as string) || "WA";

    const results = await searchCampgrounds(query, state);
    res.json({ success: true, data: results });
  } catch (error) {
    console.error("Search error:", error);
    res.status(500).json({ success: false, error: "Failed to search campgrounds" });
  }
});

// Get all saved campgrounds from database
router.get("/", async (req, res) => {
  try {
    const campgrounds = await db.select().from(schema.campgrounds);
    res.json({ success: true, data: campgrounds });
  } catch (error) {
    console.error("Error fetching campgrounds:", error);
    res.status(500).json({ success: false, error: "Failed to fetch campgrounds" });
  }
});

// Get a specific campground
router.get("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const campground = await db
      .select()
      .from(schema.campgrounds)
      .where(eq(schema.campgrounds.id, id))
      .limit(1);

    if (campground.length === 0) {
      return res.status(404).json({ success: false, error: "Campground not found" });
    }

    res.json({ success: true, data: campground[0] });
  } catch (error) {
    console.error("Error fetching campground:", error);
    res.status(500).json({ success: false, error: "Failed to fetch campground" });
  }
});

// Add a campground from Recreation.gov by facility ID
router.post("/import/:facilityId", async (req, res) => {
  try {
    const { facilityId } = req.params;

    // Check if already imported
    const existing = await db
      .select()
      .from(schema.campgrounds)
      .where(eq(schema.campgrounds.facilityId, facilityId))
      .limit(1);

    if (existing.length > 0) {
      return res.json({ success: true, data: existing[0], message: "Already imported" });
    }

    // Fetch from Recreation.gov
    const campground = await getFacilityDetails(facilityId);
    if (!campground) {
      return res.status(404).json({ success: false, error: "Campground not found on Recreation.gov" });
    }

    // Save to database
    const now = new Date().toISOString();
    const newCampground = {
      ...campground,
      amenities: JSON.stringify(campground.amenities),
      createdAt: now,
      updatedAt: now,
    };

    await db.insert(schema.campgrounds).values(newCampground);

    // Also fetch and save campsites
    const campsites = await getCampsites(facilityId);
    if (campsites.length > 0) {
      const campsiteRecords = campsites.map((site) => ({
        ...site,
        campgroundId: campground.id,
        createdAt: now,
        updatedAt: now,
      }));
      await db.insert(schema.campsites).values(campsiteRecords);
    }

    res.json({ success: true, data: campground, campsitesImported: campsites.length });
  } catch (error) {
    console.error("Import error:", error);
    res.status(500).json({ success: false, error: "Failed to import campground" });
  }
});

// Get campsites for a campground
router.get("/:id/campsites", async (req, res) => {
  try {
    const { id } = req.params;
    const campsites = await db
      .select()
      .from(schema.campsites)
      .where(eq(schema.campsites.campgroundId, id));

    res.json({ success: true, data: campsites });
  } catch (error) {
    console.error("Error fetching campsites:", error);
    res.status(500).json({ success: false, error: "Failed to fetch campsites" });
  }
});

export default router;
