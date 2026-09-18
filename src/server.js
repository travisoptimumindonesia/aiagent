import { createApp } from './app.js';
import { makeWorker } from './worker.js';
const ctx = createApp();
const stop = makeWorker(ctx).start();
const server = ctx.app.listen(Number(process.env.PORT || 3000), '0.0.0.0', () =>
  console.log('Mandarin platform ready'),
);
server.requestTimeout = 120000;
server.headersTimeout = 15000;
for (const sig of ['SIGTERM', 'SIGINT'])
  process.on(sig, () => {
    stop();
    server.close(() => {
      ctx.db.close();
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10000).unref();
  });
