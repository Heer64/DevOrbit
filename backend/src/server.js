import 'dotenv/config';
import http from 'node:http';
import mongoose from 'mongoose';
import { createApp } from './app.js';
import { closeRealtime, initRealtime } from './lib/realtime.js';

const port = Number(process.env.PORT || 5000);
const mongoUri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/devorbit';

if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
  console.error('JWT_SECRET is required and must be at least 32 characters. Set it in backend/.env.');
  process.exit(1);
}

if (!process.env.MONGODB_URI) {
  console.warn('MONGODB_URI is not set in backend/.env. Using local MongoDB: mongodb://127.0.0.1:27017/devorbit');
}

// Log connection changes while the server is running
mongoose.connection.on('disconnected', () => console.warn('MongoDB disconnected.'));
mongoose.connection.on('reconnected', () => console.log('MongoDB reconnected.'));
mongoose.connection.on('error', (error) => console.error('MongoDB error:', error.message));

const app = createApp();
let server;

try {
  // Fail after 5 seconds instead of the default 30 if MongoDB can't be reached
  await mongoose.connect(mongoUri, { serverSelectionTimeoutMS: 5000 });
  console.log(`Connected to MongoDB database: ${mongoose.connection.name}`);
  // One HTTP server for both the REST API and Socket.IO (live task updates).
  server = http.createServer(app);
  const clientOrigins = (process.env.CLIENT_ORIGIN || 'http://localhost:5173')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  initRealtime(server, { origins: clientOrigins });
  server.listen(port, () => console.log(`DevOrbit API listening on http://localhost:${port}`));
} catch (error) {
  console.error('MongoDB connection failed:', error.message);
  console.error('Check that MongoDB is running and that MONGODB_URI in backend/.env is correct.');
  process.exit(1);
}

// Close the server and database connection cleanly on Ctrl+C or shutdown
async function shutdown(signal) {
  console.log(`${signal} received. Shutting down DevOrbit API...`);
  // Closing Socket.IO also closes the HTTP server it is attached to.
  await closeRealtime();
  await mongoose.connection.close();
  console.log('MongoDB connection closed.');
  process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));