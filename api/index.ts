import type { Request, Response } from 'express';
import { createApp } from '../server';

let cachedAppPromise: ReturnType<typeof createApp> | null = null;

export default async function handler(req: Request, res: Response) {
  if (!cachedAppPromise) {
    process.env.NODE_ENV = 'production';
    cachedAppPromise = createApp();
  }
  const app = await cachedAppPromise;
  return app(req, res);
}
