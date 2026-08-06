import { Controller, Get } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { binaryExists, freeDiskGb } from '../common/host-tools';

@Controller('health')
export class HealthController {
  constructor(
    private prisma: PrismaService,
    private redis: RedisService,
  ) {}

  @Get()
  async check() {
    let database = 'ok';
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch {
      database = 'unavailable';
    }
    return {
      status: database === 'ok' ? 'ok' : 'degraded',
      database,
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
    };
  }

  @Get('detailed')
  async detailed() {
    const checks: Record<string, { status: 'ok' | 'error' | 'warning' | 'critical'; message?: string; available?: string }> = {};

    try {
      await this.prisma.$queryRaw`SELECT 1`;
      checks.database = { status: 'ok' };
    } catch (error: any) {
      checks.database = { status: 'error', message: error.message };
    }

    try {
      const client = this.redis.getClient();
      await client.ping();
      checks.redis = { status: 'ok' };
    } catch (error: any) {
      checks.redis = { status: 'error', message: error.message };
    }

    try {
      const profiles = await this.prisma.cliProfile.findMany({ select: { name: true, binary: true } });
      const cliChecks: Record<string, { status: 'ok' | 'error'; message?: string }> = {};
      for (const profile of profiles) {
        cliChecks[profile.name] = (await binaryExists(profile.binary))
          ? { status: 'ok' }
          : { status: 'error', message: `${profile.binary} not found` };
      }
      checks.cliProfiles = cliChecks as any;
    } catch (error: any) {
      checks.cliProfiles = { status: 'error', message: error.message } as any;
    }

    try {
      const projects = await this.prisma.project.findMany({ select: { worktreeBase: true } });
      if (projects.length > 0) {
        const availableNum = await freeDiskGb(projects[0].worktreeBase);
        if (availableNum !== null) {
          let diskStatus: 'ok' | 'warning' | 'critical' = 'ok';
          if (availableNum < 1) diskStatus = 'critical';
          else if (availableNum < 5) diskStatus = 'warning';
          checks.disk = { status: diskStatus, available: `${availableNum}G` };
        }
      }
    } catch {}

    const allOk = Object.entries(checks).every(([key, value]) => {
      if (key === 'cliProfiles') {
        return Object.values(value as any).every((c: any) => c.status === 'ok');
      }
      if (key === 'disk') {
        return value.status === 'ok' || value.status === 'warning';
      }
      return value.status === 'ok';
    });

    return {
      status: allOk ? 'ok' : 'degraded',
      checks,
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
    };
  }
}
