import type { Request, Response } from 'express';
import { createApiApp } from './createApiApp';

let cachedAppPromise: ReturnType<typeof createApiApp> | null = null;

export default async function handler(req: Request, res: Response) {
  if (!cachedAppPromise) {
    process.env.NODE_ENV = 'production';
    cachedAppPromise = createApiApp();
  }
  const app = await cachedAppPromise;
  return app(req, res);
}
