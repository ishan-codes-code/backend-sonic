import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  HttpException,
  HttpStatus,
  Post,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { neon } from '@neondatabase/serverless';
import { execFile } from 'child_process';
import type { Response } from 'express';
import { promisify } from 'util';
import { resolve } from 'path';
import {
  getRuntimeConfigEnvironment,
  getEnvLockedKeys,
  reloadRuntimeConfig,
  RUNTIME_CONFIG_KEYS,
  saveRuntimeConfig,
  SETUP_CONFIG_KEYS,
  verifySetupToken,
} from '../../infrastructure/config/runtime-config';
import {
  isKeyConfigured,
  isSetupRequired,
} from '../../infrastructure/config/setup-requirements';

const execFileAsync = promisify(execFile);
const DATABASE_TIMEOUT_MS = 5000;

@Controller('setup')
export class SetupController {
  @Get('status')
  getStatus(@Headers('x-setup-token') token?: string) {
    this.authorize(token);
    const config = reloadRuntimeConfig();
    const configured: Record<string, boolean> = {};

    for (const key of RUNTIME_CONFIG_KEYS) {
      configured[key] = isKeyConfigured(config, key);
    }

    return {
      setupRequired: isSetupRequired(config),
      configured,
      envLocked: getEnvLockedKeys(),
    };
  }

  @Post('config')
  async saveConfig(
    @Headers('x-setup-token') token: string | undefined,
    @Body() body: unknown,
    @Res({ passthrough: true }) response: Response,
  ) {
    this.authorize(token);

    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      throw new BadRequestException('Configuration body must be an object.');
    }

    const patch = body as Record<string, unknown>;
    const allowedKeys = new Set(SETUP_CONFIG_KEYS);
    const keys = Object.keys(patch);
    if (keys.length === 0) {
      throw new BadRequestException(
        'At least one configuration key is required.',
      );
    }

    const unknownKey = keys.find((key) => !allowedKeys.has(key));
    if (unknownKey) {
      throw new BadRequestException(
        `Configuration key is not allowed: ${unknownKey}`,
      );
    }

    const envLocked = new Set(getEnvLockedKeys());
    const lockedKey = keys.find((key) => envLocked.has(key));
    if (lockedKey) {
      throw new BadRequestException(
        `${lockedKey} is environment-locked and cannot be changed through setup.`,
      );
    }

    const stringPatch: Record<string, string> = {};
    for (const [key, value] of Object.entries(patch)) {
      if (
        typeof value !== 'string' ||
        value.length > 16_384 ||
        value.includes('\0')
      ) {
        throw new BadRequestException(
          `${key} must be a string of at most 16384 characters.`,
        );
      }
      stringPatch[key] = value;
    }

    let migration: { status: string; steps: string[] } = {
      status: 'not-requested',
      steps: [],
    };
    if (stringPatch.DATABASE_URL) {
      let timeout: ReturnType<typeof setTimeout> | undefined;
      try {
        const query = neon(stringPatch.DATABASE_URL);
        await Promise.race([
          query`select 1`,
          new Promise<never>((_, reject) => {
            timeout = setTimeout(
              () => reject(new Error('Database validation timed out')),
              DATABASE_TIMEOUT_MS,
            );
          }),
        ]);
      } catch {
        throw new BadRequestException({
          message:
            'DATABASE_URL validation failed: could not connect and run select 1.',
          migration: { status: 'not-started', steps: [] },
        });
      } finally {
        if (timeout) clearTimeout(timeout);
      }

      const migrationSteps = ['Database connection validated'];
      try {
        await execFileAsync(
          process.execPath,
          [
            resolve(process.cwd(), 'node_modules/drizzle-kit/bin.cjs'),
            'migrate',
          ],
          {
            cwd: process.cwd(),
            env: getRuntimeConfigEnvironment({
              DATABASE_URL: stringPatch.DATABASE_URL,
            }),
            timeout: 120_000,
            maxBuffer: 1024 * 1024,
          },
        );
        migration = {
          status: 'completed',
          steps: [...migrationSteps, 'Drizzle migrations applied'],
        };
      } catch {
        throw new HttpException(
          {
            message:
              'Database connected, but migrations failed. Configuration was not saved; check the migration files and database permissions.',
            migration: {
              status: 'failed',
              steps: migrationSteps,
            },
          },
          HttpStatus.BAD_GATEWAY,
        );
      }
    }

    saveRuntimeConfig(stringPatch);
    const updatedConfig = reloadRuntimeConfig();

    response.once('finish', () => {
      const restart = setTimeout(() => process.exit(0), 250);
      restart.unref();
    });

    return {
      saved: true,
      setupRequired: isSetupRequired(updatedConfig),
      migration,
      restartRequired: true,
    };
  }

  private authorize(token: string | undefined): void {
    if (!verifySetupToken(token)) {
      throw new UnauthorizedException(
        'A valid X-Setup-Token header is required.',
      );
    }
  }
}
