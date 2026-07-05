import type { FastifyRequest } from 'fastify';

export const getApiBase = (request: FastifyRequest) => {
  const fromEnv = process.env.PUBLIC_API_URL || process.env.API_PUBLIC_URL;
  if (fromEnv) {
    return fromEnv.replace(/\/$/, '');
  }

  const forwardedProto = request.headers['x-forwarded-proto'];
  const proto = typeof forwardedProto === 'string' ? forwardedProto.split(',')[0] : 'http';
  const forwardedHost = request.headers['x-forwarded-host'];
  const host = typeof forwardedHost === 'string' ? forwardedHost.split(',')[0] : request.headers.host;
  return `${proto}://${host}`;
};
