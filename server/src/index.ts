import fs from 'fs';
import path from 'path';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import authRoutes from './api/auth/realdebrid';
import animeRoutes from './api/anime/tmdb';
import streamsRoutes from './api/streams/resolve';
import autoResolveRoutes from './api/streams/auto-resolve';
import playRoutes from './api/streams/play';
import subtitleRoutes from './api/subtitles';

const loadLocalEnv = () => {
  const envPath = path.resolve(process.cwd(), '.env');
  if (!fs.existsSync(envPath)) {
    return;
  }

  const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    const separatorIndex = trimmed.indexOf('=');
    if (separatorIndex === -1) {
      continue;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    const rawValue = trimmed.slice(separatorIndex + 1).trim();
    const value = rawValue.replace(/^['"]|['"]$/g, '');
    if (key && process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
};

loadLocalEnv();

const server = Fastify({ logger: true });

void server.register(cors, { origin: true });

void server.register(authRoutes, { prefix: '/auth/realdebrid' });
void server.register(animeRoutes, { prefix: '/anime' });
void server.register(streamsRoutes, { prefix: '/streams' });
void server.register(autoResolveRoutes, { prefix: '/streams' });
void server.register(playRoutes, { prefix: '/streams' });
void server.register(subtitleRoutes, { prefix: '/subtitles' });
void server.get('/health', async () => ({ ok: true }));

const start = async () => {
  try {
    const port = Number(process.env.PORT || 4000);
    const host = process.env.HOST || '0.0.0.0';
    await server.listen({ port, host });
  } catch (err) {
    server.log.error(err);
    process.exit(1);
  }
};

start();
