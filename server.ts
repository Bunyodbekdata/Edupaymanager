import express from 'express';
import path from 'node:path';
import { createApiApp, resetSecurityRateLimits } from './src/server/createApiApp';

export { resetSecurityRateLimits };

export async function createApp() {
  const app = await createApiApp();

  const isTestEnvironment =
    process.env.NODE_ENV === 'test' ||
    process.execArgv.includes('--test') ||
    process.argv.includes('--test');

  if (process.env.NODE_ENV !== 'production' && !isTestEnvironment && !process.env.VERCEL) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true, allowedHosts: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else if (!isTestEnvironment) {
    const distPath = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  return app;
}

const PORT = Number(process.env.PORT) || 3000;
const isTest =
  process.env.NODE_ENV === 'test' ||
  process.execArgv.some((a) => a.includes('test')) ||
  process.argv.some((a) => a.includes('test')) ||
  Boolean(process.env.VERCEL);

if (!isTest) {
  createApp().then((app) => {
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`EduPay Manager server running on http://0.0.0.0:${PORT}`);
    });
  });
}
