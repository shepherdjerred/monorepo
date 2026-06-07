# Roadmap

This document tracks the planned work for this repository.

## Planned

- Self-heal when streaming breaks
- Dynamic ROM names

- Swap to Deno
  - Nice technical improvement, but not user-facing or high-priority
- Collect statistics
  - hours played, commands sent, etc.
- Periodic screenshots/session summaries
  - Would be nice to send a screenshot when someone stops playing
  - Would be even cooler to do analysis. Send events when Pokemon are captured, gym bosses are defeated, etc.
    - Could possibly be implemented via AI
      - OCR on screen w/ some model
- Docker HEALTHCHECK
- Automated tests
- Simplified onboarding
  - Possibly some sort of wizard/GUI
  - GUI could help the user install dependencies/configure the application
- Database with Prisma
- Notifications to use web UI for easier input
- Stream overlay

### UI

- Auth
  - Could use a JWT. Send via Discord, save to browser. Requires a server-side secret
  - Does Discord do SSO?
- Player must be in channel to send commands
- Player must be watching stream

## In Progress

- Load state automatically

## Complete

- Upload/backup save files
  - Upload files to S3?
- Gamepad support
- Automatically set Discord settings
- Fullscreen mode
- Require players to be in channel to send commands
- Stop streaming on inactivity
- Fix Discord text commands
- Make development/production closer
- Minimum watcher count
- Disable Krisp
- Fix start key
- Save state automatically
- Fullscreen
- Vendor all dependencies
  - EmulatorJS is the big one
  - Node dependencies would be good, too, just in case
