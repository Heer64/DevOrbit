// Starts the real DevOrbit API for the end-to-end tests.
//
// - In CI, E2E_MONGODB_URI points at the MongoDB service container.
// - Locally, if E2E_MONGODB_URI is not set, a throw-away in-memory MongoDB is started
//   (mongodb-memory-server from backend/devDependencies), so nothing needs to be installed
//   and your real development database is never touched.
//
// Playwright runs this through `webServer` in playwright.config.js.
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const backendRequire = createRequire(new URL('../backend/package.json', import.meta.url));

let uri = process.env.E2E_MONGODB_URI;
let memoryServer = null;

if (!uri) {
  const { MongoMemoryServer } = await import(pathToFileURL(backendRequire.resolve('mongodb-memory-server')).href);
  memoryServer = await MongoMemoryServer.create();
  uri = memoryServer.getUri('devorbit_e2e');
  console.log(`[e2e] Using in-memory MongoDB at ${uri}`);
}

process.env.MONGODB_URI = uri;
process.env.PORT = process.env.PORT || '5000';
process.env.CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || 'http://localhost:5173';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'e2e-secret-e2e-secret-e2e-secret-123456';
// 'test' turns off the API rate limits, which a fast test run would otherwise hit.
process.env.NODE_ENV = 'test';

const stop = async () => {
  if (memoryServer) await memoryServer.stop().catch(() => {});
};
process.on('exit', () => { memoryServer?.stop().catch(() => {}); });
process.on('SIGTERM', async () => { await stop(); process.exit(0); });

await import(pathToFileURL(backendRequire.resolve('./src/server.js')).href);
