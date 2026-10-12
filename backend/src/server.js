import 'dotenv/config';
import mongoose from 'mongoose';
import { createApp } from './app.js';

const port = Number(process.env.PORT || 5000);

if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
  console.error('JWT_SECRET is required and must be at least 32 characters. Set it in backend/.env.');
  process.exit(1);
}

const app = createApp();

try {
  await mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/devorbit');
  console.log(`Connected to MongoDB database: ${mongoose.connection.name}`);
  app.listen(port, () => console.log(`DevOrbit API listening on http://localhost:${port}`));
} catch (error) {
  console.error('MongoDB connection failed:', error.message);
  process.exit(1);
}
