import { Router } from "express";
import { db, schema } from "../db/index.js";
import { eq } from "drizzle-orm";
import { generateId } from "@camping/shared";

const router = Router();

// Get or create user by email (simplified auth for now)
router.post("/auth", async (req, res) => {
  try {
    const { email, name } = req.body;

    if (!email) {
      return res.status(400).json({ success: false, error: "Email is required" });
    }

    // Check if user exists
    let user = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.email, email))
      .limit(1);

    if (user.length > 0) {
      return res.json({ success: true, data: user[0] });
    }

    // Create new user
    const now = new Date().toISOString();
    const newUser = {
      id: generateId(),
      email,
      name: name || null,
      notificationPreferences: JSON.stringify({
        email: true,
        emailAddress: email,
        push: false,
      }),
      createdAt: now,
      updatedAt: now,
    };

    await db.insert(schema.users).values(newUser);

    res.json({ success: true, data: newUser });
  } catch (error) {
    console.error("Auth error:", error);
    res.status(500).json({ success: false, error: "Failed to authenticate user" });
  }
});

// Get user by ID
router.get("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const user = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, id))
      .limit(1);

    if (user.length === 0) {
      return res.status(404).json({ success: false, error: "User not found" });
    }

    res.json({ success: true, data: user[0] });
  } catch (error) {
    console.error("Error fetching user:", error);
    res.status(500).json({ success: false, error: "Failed to fetch user" });
  }
});

// Update user preferences
router.patch("/:id/preferences", async (req, res) => {
  try {
    const { id } = req.params;
    const preferences = req.body;

    const existing = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, id))
      .limit(1);

    if (existing.length === 0) {
      return res.status(404).json({ success: false, error: "User not found" });
    }

    const currentPrefs = JSON.parse(existing[0].notificationPreferences);
    const updatedPrefs = { ...currentPrefs, ...preferences };

    await db
      .update(schema.users)
      .set({
        notificationPreferences: JSON.stringify(updatedPrefs),
        updatedAt: new Date().toISOString(),
      })
      .where(eq(schema.users.id, id));

    const updated = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, id))
      .limit(1);

    res.json({ success: true, data: updated[0] });
  } catch (error) {
    console.error("Error updating preferences:", error);
    res.status(500).json({ success: false, error: "Failed to update preferences" });
  }
});

export default router;
