import { FastifyInstance } from 'fastify';
import TMDB, { TmdbError } from '../../services/tmdb';

const getPage = (value: unknown) => {
  const page = Number(value || 1);
  return Number.isFinite(page) && page > 0 ? Math.floor(page) : 1;
};

const sendError = (reply: { status: (statusCode: number) => { send: (body: unknown) => unknown } }, error: unknown) => {
  const statusCode = error instanceof TmdbError ? error.statusCode : 500;
  return reply.status(statusCode).send({
    error: error instanceof Error ? error.message : 'TMDB request failed'
  });
};

export default async function (fastify: FastifyInstance) {
  fastify.get('/trending', async (request, reply) => {
    try {
      const query = request.query as { page?: string };
      return reply.send(await TMDB.getTrending(getPage(query.page)));
    } catch (error) {
      request.log.error(error);
      return sendError(reply, error);
    }
  });

  fastify.get('/home', async (request, reply) => {
    try {
      return reply.send(await TMDB.getHomeRows());
    } catch (error) {
      request.log.error(error);
      return sendError(reply, error);
    }
  });

  fastify.get('/airing-today', async (request, reply) => {
    try {
      const query = request.query as { page?: string };
      return reply.send(await TMDB.getAiringToday(getPage(query.page)));
    } catch (error) {
      request.log.error(error);
      return sendError(reply, error);
    }
  });

  fastify.get('/on-the-air', async (request, reply) => {
    try {
      const query = request.query as { page?: string };
      return reply.send(await TMDB.getOnTheAir(getPage(query.page)));
    } catch (error) {
      request.log.error(error);
      return sendError(reply, error);
    }
  });

  fastify.get('/search', async (request, reply) => {
    try {
      const query = request.query as { q?: string; page?: string };
      return reply.send(await TMDB.search(query.q || '', getPage(query.page)));
    } catch (error) {
      request.log.error(error);
      return sendError(reply, error);
    }
  });

  fastify.get('/:id', async (request, reply) => {
    try {
      const params = request.params as { id: string };
      return reply.send(await TMDB.getDetails(params.id));
    } catch (error) {
      request.log.error(error);
      return sendError(reply, error);
    }
  });

  fastify.get('/:id/season/:seasonNumber', async (request, reply) => {
    try {
      const params = request.params as { id: string; seasonNumber: string };
      return reply.send(await TMDB.getSeason(params.id, params.seasonNumber));
    } catch (error) {
      request.log.error(error);
      return sendError(reply, error);
    }
  });
}
