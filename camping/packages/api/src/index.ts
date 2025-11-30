import express from "express";
import cors from "cors";
import campgroundsRouter from "./routes/campgrounds.js";
import watchesRouter from "./routes/watches.js";
import usersRouter from "./routes/users.js";
import availabilityRouter from "./routes/availability.js";
import alertsRouter from "./routes/alerts.js";

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json());

// Request logging
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} ${req.method} ${req.path}`);
  next();
});

// Routes
app.use("/api/campgrounds", campgroundsRouter);
app.use("/api/watches", watchesRouter);
app.use("/api/users", usersRouter);
app.use("/api/availability", availabilityRouter);
app.use("/api/alerts", alertsRouter);

// Health check
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// Error handling
app.use(
  (
    err: Error,
    req: express.Request,
    res: express.Response,
    next: express.NextFunction
  ) => {
    console.error("Unhandled error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
);

// 404 handler
app.use((req, res) => {
  res.status(404).json({ success: false, error: "Not found" });
});

app.listen(PORT, () => {
  console.log(`Camping API server running on http://localhost:${PORT}`);
});

export default app;
