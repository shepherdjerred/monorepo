import { Router } from "express";
import { db, schema } from "../db/index.js";
import { eq, and, desc } from "drizzle-orm";

const router = Router();

// Get all alerts for a user
router.get("/user/:userId", async (req, res) => {
  try {
    const { userId } = req.params;
    const { status } = req.query;

    let query = db
      .select()
      .from(schema.alerts)
      .where(eq(schema.alerts.userId, userId))
      .orderBy(desc(schema.alerts.createdAt));

    const alerts = await query;

    // Filter by status if provided
    const filteredAlerts = status
      ? alerts.filter((a) => a.status === status)
      : alerts;

    res.json({ success: true, data: filteredAlerts });
  } catch (error) {
    console.error("Error fetching alerts:", error);
    res.status(500).json({ success: false, error: "Failed to fetch alerts" });
  }
});

// Get a specific alert
router.get("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const alert = await db
      .select()
      .from(schema.alerts)
      .where(eq(schema.alerts.id, id))
      .limit(1);

    if (alert.length === 0) {
      return res.status(404).json({ success: false, error: "Alert not found" });
    }

    res.json({ success: true, data: alert[0] });
  } catch (error) {
    console.error("Error fetching alert:", error);
    res.status(500).json({ success: false, error: "Failed to fetch alert" });
  }
});

// Update alert status (dismiss, etc.)
router.patch("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    if (!status || !["pending", "sent", "dismissed", "expired"].includes(status)) {
      return res.status(400).json({
        success: false,
        error: "Valid status is required (pending, sent, dismissed, expired)",
      });
    }

    const existing = await db
      .select()
      .from(schema.alerts)
      .where(eq(schema.alerts.id, id))
      .limit(1);

    if (existing.length === 0) {
      return res.status(404).json({ success: false, error: "Alert not found" });
    }

    const updateData: Record<string, unknown> = { status };
    if (status === "sent") {
      updateData.sentAt = new Date().toISOString();
    }

    await db.update(schema.alerts).set(updateData).where(eq(schema.alerts.id, id));

    const updated = await db
      .select()
      .from(schema.alerts)
      .where(eq(schema.alerts.id, id))
      .limit(1);

    res.json({ success: true, data: updated[0] });
  } catch (error) {
    console.error("Error updating alert:", error);
    res.status(500).json({ success: false, error: "Failed to update alert" });
  }
});

// Delete an alert
router.delete("/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const existing = await db
      .select()
      .from(schema.alerts)
      .where(eq(schema.alerts.id, id))
      .limit(1);

    if (existing.length === 0) {
      return res.status(404).json({ success: false, error: "Alert not found" });
    }

    await db.delete(schema.alerts).where(eq(schema.alerts.id, id));

    res.json({ success: true, message: "Alert deleted" });
  } catch (error) {
    console.error("Error deleting alert:", error);
    res.status(500).json({ success: false, error: "Failed to delete alert" });
  }
});

export default router;
