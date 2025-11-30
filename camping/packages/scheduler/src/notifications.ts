import nodemailer from "nodemailer";

interface EmailNotificationParams {
  to: string;
  campgroundName: string;
  campsiteName: string;
  availableDates: string[];
  reservationUrl: string;
}

// Create transporter - configure via environment variables
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || "smtp.gmail.com",
  port: parseInt(process.env.SMTP_PORT || "587"),
  secure: process.env.SMTP_SECURE === "true",
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

/**
 * Send email notification about campsite availability
 */
export async function sendEmailNotification(
  params: EmailNotificationParams
): Promise<void> {
  const { to, campgroundName, campsiteName, availableDates, reservationUrl } =
    params;

  // Format dates nicely
  const formattedDates = availableDates
    .map((d) => {
      const date = new Date(d + "T12:00:00");
      return date.toLocaleDateString("en-US", {
        weekday: "short",
        month: "short",
        day: "numeric",
        year: "numeric",
      });
    })
    .join(", ");

  const subject = `🏕️ Campsite Available: ${campsiteName} at ${campgroundName}`;

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      line-height: 1.6;
      color: #333;
      max-width: 600px;
      margin: 0 auto;
      padding: 20px;
    }
    .header {
      background: linear-gradient(135deg, #2d5016 0%, #4a7c23 100%);
      color: white;
      padding: 30px;
      border-radius: 10px 10px 0 0;
      text-align: center;
    }
    .header h1 {
      margin: 0;
      font-size: 24px;
    }
    .content {
      background: #f9f9f9;
      padding: 30px;
      border-radius: 0 0 10px 10px;
    }
    .campsite-info {
      background: white;
      padding: 20px;
      border-radius: 8px;
      margin-bottom: 20px;
      border-left: 4px solid #4a7c23;
    }
    .dates {
      background: #e8f5e9;
      padding: 15px;
      border-radius: 8px;
      margin-bottom: 20px;
    }
    .dates h3 {
      margin: 0 0 10px 0;
      color: #2d5016;
    }
    .cta-button {
      display: inline-block;
      background: #4a7c23;
      color: white;
      padding: 15px 30px;
      text-decoration: none;
      border-radius: 8px;
      font-weight: bold;
      font-size: 16px;
    }
    .cta-button:hover {
      background: #2d5016;
    }
    .footer {
      text-align: center;
      margin-top: 30px;
      color: #666;
      font-size: 12px;
    }
  </style>
</head>
<body>
  <div class="header">
    <h1>🏕️ Campsite Available!</h1>
  </div>
  <div class="content">
    <div class="campsite-info">
      <h2 style="margin: 0 0 10px 0;">${campsiteName}</h2>
      <p style="margin: 0; color: #666;">${campgroundName}</p>
    </div>

    <div class="dates">
      <h3>Available Dates:</h3>
      <p style="margin: 0;">${formattedDates}</p>
    </div>

    <p>A campsite matching your watch criteria is now available! These spots go fast, so book soon.</p>

    <p style="text-align: center; margin-top: 25px;">
      <a href="${reservationUrl}" class="cta-button">Reserve Now →</a>
    </p>
  </div>
  <div class="footer">
    <p>You received this email because you set up a campsite watch.</p>
    <p>Camping Reservation Notifier</p>
  </div>
</body>
</html>
`;

  const text = `
Campsite Available!

${campsiteName} at ${campgroundName}

Available Dates:
${formattedDates}

A campsite matching your watch criteria is now available! These spots go fast, so book soon.

Reserve Now: ${reservationUrl}

---
You received this email because you set up a campsite watch.
`;

  // Only send if SMTP is configured
  if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
    console.log("SMTP not configured. Would have sent email:");
    console.log(`  To: ${to}`);
    console.log(`  Subject: ${subject}`);
    console.log(`  Dates: ${formattedDates}`);
    return;
  }

  await transporter.sendMail({
    from: process.env.SMTP_FROM || process.env.SMTP_USER,
    to,
    subject,
    text,
    html,
  });
}
