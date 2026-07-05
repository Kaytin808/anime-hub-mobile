import { FastifyInstance } from 'fastify';
import RD, { RealDebridError } from '../../services/realdebrid';

export default async function (fastify: FastifyInstance) {
  fastify.get('/status', async (request, reply) => {
    try {
      const authHeader = request.headers.authorization;
      const token = authHeader?.match(/^Bearer\s+(.+)$/i)?.[1];
      const user = await RD.getUser(token);
      return reply.send({
        connected: true,
        user
      });
    } catch (error) {
      const statusCode = error instanceof RealDebridError ? error.statusCode : 500;
      return reply.status(statusCode).send({
        connected: false,
        error: error instanceof Error ? error.message : 'failed to validate RealDebrid token'
      });
    }
  });

  fastify.post('/start', async (request, reply) => {
    try {
      const device = await RD.startDeviceAuth();
      return reply.send(device);
    } catch (error) {
      request.log.error(error);
      const statusCode = error instanceof RealDebridError ? error.statusCode : 500;
      return reply.status(statusCode).send({
        error: error instanceof Error ? error.message : 'failed to start RealDebrid auth'
      });
    }
  });

  fastify.post('/poll', async (request, reply) => {
    try {
      const body = request.body as { device_code?: string } | null;
      const token = await RD.pollDeviceAuth(body?.device_code || '');
      return reply.send(token);
    } catch (error) {
      request.log.error(error);
      const statusCode = error instanceof RealDebridError ? error.statusCode : 500;
      return reply.status(statusCode).send({
        error: error instanceof Error ? error.message : 'failed to poll RealDebrid auth'
      });
    }
  });
}
