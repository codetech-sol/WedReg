/**
 * Vercel serverless entry point.
 * All routes are rewritten here (see vercel.json); the Express app handles
 * routing, static assets, and the API exactly as it does locally.
 */
module.exports = require('../backend/server');
