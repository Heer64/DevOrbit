#!/usr/bin/env node
/*
 * [Sprint 1 · gaps] Seed a development database with demo data (src/seed/seedData.js).
 *
 *   cd backend
 *   npm run seed                 add the demo team (does nothing if it is already there)
 *   npm run seed -- --reset      remove the demo team and its projects, then add it again
 *
 * Uses MONGODB_URI from backend/.env (same as the server). Optional SEED_PASSWORD sets the
 * password of every demo account (default DevOrbit@2026). Refuses to run when NODE_ENV=production.
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import { seedDatabase } from '../src/seed/seedData.js';

const args = new Set(process.argv.slice(2));
const reset = args.has('--reset');

if (process.env.NODE_ENV === 'production') {
  console.error('Refusing to seed: NODE_ENV is "production". The seed is for development and test databases only.');
  process.exit(1);
}

const mongoUri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/devorbit';

try {
  await mongoose.connect(mongoUri, { serverSelectionTimeoutMS: 5000 });
  console.log(`Connected to MongoDB database: ${mongoose.connection.name}`);
  await Promise.all(Object.values(mongoose.models).map((model) => model.init()));

  const result = await seedDatabase({ reset, password: process.env.SEED_PASSWORD || undefined });
  if (!result.seeded) {
    console.log(result.reason);
  } else {
    if (result.removed) console.log(`Removed the old demo data: ${result.removed.users} users, ${result.removed.projects} projects.`);
    console.log(`Seeded ${result.users.length} users, ${result.projects.length} projects and ${result.tasks} tasks.`);
    console.log('Log in with any of these (password for all of them below):');
    for (const user of result.users) console.log(`  ${user.email}  (${user.name}, @${user.username})`);
    console.log(`Password: ${result.password}`);
  }
  await mongoose.disconnect();
  process.exit(0);
} catch (error) {
  console.error('Seeding failed:', error.message);
  console.error('Check that MongoDB is running and that MONGODB_URI in backend/.env is correct.');
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
}
