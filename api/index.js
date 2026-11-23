import app from '../server/vercel-app.js';

// Vercel rewrites every /api/* request to this single function so the
// simulated payment intent and confirmation use the same SQLite instance.
export default function handler(req, res) {
  const incoming = new URL(req.url, 'http://localhost');
  const routedPath = incoming.searchParams.get('path');

  if (routedPath !== null) {
    const safePath = routedPath.split('/').filter(Boolean).map(encodeURIComponent).join('/');
    const query = new URLSearchParams(incoming.searchParams);
    query.delete('path');
    req.url = `/api/${safePath}${query.size ? `?${query}` : ''}`;
  }

  return app(req, res);
}
