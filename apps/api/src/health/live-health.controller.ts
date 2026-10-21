import { Controller, Get, Inject, Req, Res } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import type { Request, Response } from 'express';
import { logError } from '../common/log-redaction.js';
import { HealthRateLimiter, pingDatabase, type HealthProbe } from './live-health.js';

export const HEALTH_PROBE = Symbol('HEALTH_PROBE');
export const HEALTH_LIMITER = Symbol('HEALTH_LIMITER');

export class PrismaHealthProbe implements HealthProbe {
  private prisma: PrismaClient | null = null;

  async ping(): Promise<void> {
    if (!process.env.DATABASE_URL || !process.env.DIRECT_URL) {
      throw new Error('database is not configured');
    }
    this.prisma ??= new PrismaClient();
    await pingDatabase(() => this.prisma!.$queryRaw`SELECT 1`);
  }

  async disconnect(): Promise<void> {
    await this.prisma?.$disconnect();
    this.prisma = null;
  }
}

@Controller('v1/health')
export class LiveHealthController {
  constructor(
    @Inject(HEALTH_PROBE) private readonly probe: HealthProbe,
    @Inject(HEALTH_LIMITER) private readonly limiter: HealthRateLimiter,
  ) {}

  @Get()
  async get(@Req() req: Request, @Res() res: Response): Promise<void> {
    res.setHeader('Cache-Control', 'no-store');
    const decision = this.limiter.consume(clientIp(req));
    if (!decision.allowed) {
      res.setHeader('Retry-After', String(decision.retryAfterSeconds));
      res.status(429).json({
        statusCode: 429,
        error: 'rate_limited',
        message: 'Too many requests.',
      });
      return;
    }
    try {
      await this.probe.ping();
      res.status(200).json({ status: 'ok' });
    } catch {
      logError('Health check failed.');
      res.status(503).json({ status: 'unavailable' });
    }
  }
}

/**
 * One trusted hop. The rightmost X-Forwarded-For address is the client that
 * hop saw. A leftmost address the caller added does not mint a new bucket.
 * With no header, req.ip is the socket peer (`trust proxy` is 1).
 */
function clientIp(req: Request): string {
  const forwarded = req.headers['x-forwarded-for'];
  const header = Array.isArray(forwarded) ? forwarded.join(',') : forwarded;
  if (typeof header === 'string' && header.trim()) {
    const parts = header.split(',').map((part) => part.trim()).filter(Boolean);
    const client = parts[parts.length - 1];
    if (client) {
      return client;
    }
  }
  return req.ip || req.socket.remoteAddress || 'unknown';
}
