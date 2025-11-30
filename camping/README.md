# Camping Reservation Notifier

A system to monitor Washington state campsite availability and get notified when reservations open up.

## Features

- **Campground Search**: Search for campgrounds on Recreation.gov
- **Watch List**: Monitor specific campgrounds and date ranges
- **Availability Checker**: Periodic background checks for open campsites
- **Email Notifications**: Get alerted when sites become available

## Architecture

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   Web UI        │────▶│   Backend API   │────▶│   Database      │
│   (Astro/React) │     │   (Express/TS)  │     │   (SQLite)      │
└─────────────────┘     └────────┬────────┘     └─────────────────┘
                                 │
                        ┌────────▼────────┐
                        │  Scheduler      │
                        │  (node-cron)    │
                        └────────┬────────┘
                                 │
                        ┌────────▼────────┐
                        │ Recreation.gov  │
                        │     API         │
                        └─────────────────┘
```

## Packages

- **@camping/shared** - Shared types, utilities, and constants
- **@camping/api** - Express REST API with SQLite database
- **@camping/scheduler** - Background job runner for availability checks
- **@camping/web** - Astro + React + Tailwind frontend

## Getting Started

### Prerequisites

- Node.js 20+
- npm 10+

### Installation

```bash
cd camping
npm install
```

### Development

Start all services:

```bash
# Terminal 1: API server
npm run dev:api

# Terminal 2: Web frontend
npm run dev:web

# Terminal 3: Scheduler (optional, for background checks)
npm run dev:scheduler
```

The web UI will be available at http://localhost:3000
The API will be available at http://localhost:3001

### Database Setup

The database will be automatically created on first API start. To generate migrations:

```bash
cd packages/api
npm run db:generate
npm run db:migrate
```

### Environment Variables

Create a `.env` file in the root directory:

```env
# SMTP settings for email notifications
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your-email@gmail.com
SMTP_PASS=your-app-password
SMTP_FROM=Camping Notifier <your-email@gmail.com>

# Scheduler settings
CHECK_INTERVAL=*/15 * * * *  # Cron expression (default: every 15 minutes)

# API settings
PORT=3001
DATABASE_PATH=./data/camping.db
```

## Usage

1. **Set up your account**: Go to Settings and enter your email
2. **Search for campgrounds**: Use the search on the home page
3. **Import a campground**: Click "Add & View" to import campground data
4. **Create a watch**: Select your dates and create a watch
5. **Get notified**: The scheduler will check availability and email you when sites open up

## Data Sources

- **Recreation.gov**: Federal campgrounds (Olympic, Mount Rainier, North Cascades, etc.)
- **WA State Parks**: Coming soon

## Tech Stack

- **Frontend**: Astro, React, Tailwind CSS
- **Backend**: Express, TypeScript
- **Database**: SQLite with Drizzle ORM
- **Scheduler**: node-cron
- **Notifications**: Nodemailer
