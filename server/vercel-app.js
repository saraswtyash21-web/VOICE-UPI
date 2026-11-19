import { createApp } from './app.js';
import { openDatabase } from './db.js';
import { SimulatedPaymentProvider } from './provider.js';

// This deployment adapter is for the classroom simulation. Vercel instances
// have ephemeral storage; use a managed database before relying on persistence.
const db = openDatabase('/tmp/voiceguide-upi.sqlite');
const app = createApp(db, { provider: new SimulatedPaymentProvider() });
export default app;
