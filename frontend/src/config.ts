// API base URL — configurable via environment variable at build time.
// For local development: defaults to http://localhost:8000
// For production: set REACT_APP_API_URL when building the frontend.
//   Example: REACT_APP_API_URL=https://incident-tracker-api.onrender.com npm run build
export const API_BASE_URL =
  process.env.REACT_APP_API_URL || 'http://localhost:8000';
