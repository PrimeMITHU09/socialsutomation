// Vercel Serverless Entry Point
// Re-exports the request handler from src/server.js
const handler = require('../src/server');
module.exports = handler;
module.exports.config = { api: { bodyParser: false } };
