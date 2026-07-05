import { FastifyInstance } from 'fastify';
import RD, { RealDebridError } from '../../services/realdebrid';
import { attachPlaybackUrls } from '../../utils/attach-playback';
import { resolvePrivateSourceStream } from '../../utils/private-source-resolver';
import { getApiBase } from '../../utils/request-base';
import { resolveSourceLink } from '../../utils/source-link-cache';

const getBearerToken = (authorization?: string) => {
  const match = authorization?.match(/^Bearer\s+(.+)$/i);
  return match?.[1];
};

export default async function (fastify: FastifyInstance) {
  fastify.post('/resolve', async (request, reply) => {
    const body = request.body as {
      source?: string;
      token?: string;
      onlyCached?: boolean;
      episodeNumber?: number;
      seasonNumber?: number;
    } | null;

    if (!body?.source) {
      return reply.status(400).send({ error: 'missing source (magnet or url)' });
    }

    try {
      const token = body.token || getBearerToken(request.headers.authorization);
      const privateStream = await resolvePrivateSourceStream(body.source);
      const result = privateStream
        ? [privateStream]
        : await RD.unrestrict(resolveSourceLink(body.source), token, {
            onlyCached: body.onlyCached,
            episodeNumber: body.episodeNumber,
            seasonNumber: body.seasonNumber
          });

      return reply.send({
        streams: attachPlaybackUrls(result, getApiBase(request))
      });
    } catch (error) {
      request.log.error(error);
      const statusCode = error instanceof RealDebridError ? error.statusCode : 500;
      return reply.status(statusCode).send({
        error: error instanceof Error ? error.message : 'failed to resolve stream'
      });
    }
  });
}
