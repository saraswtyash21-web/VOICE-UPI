import app from '../server/vercel-app.js';

export default function handler(req, res) {
  const apiPath = typeof req.query?.path === 'string' ? req.query.path : '';
  req.url = `/api/${apiPath}`;
  return app(req, res);
}
