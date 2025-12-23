const raven = require('raven');

if (process.env.SENTRY_DSN) {
  raven.config(process.env.SENTRY_DSN).install();
}
