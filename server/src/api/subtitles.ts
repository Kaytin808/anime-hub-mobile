import { FastifyInstance } from 'fastify';

const looksLikeSrt = (text: string) =>
  /\d{2}:\d{2}:\d{2},\d{3}\s+-->\s+\d{2}:\d{2}:\d{2},\d{3}/.test(text);

const convertSrtToVtt = (text: string) => {
  const normalized = text.replace(/^\uFEFF/, '').replace(/\r+/g, '');
  const body = normalized.replace(
    /(\d{2}:\d{2}:\d{2}),(\d{3})\s+-->\s+(\d{2}:\d{2}:\d{2}),(\d{3})/g,
    '$1.$2 --> $3.$4'
  );
  return `WEBVTT\n\n${body}`;
};

export default async function (fastify: FastifyInstance) {
  fastify.post('/search', async (request, reply) => {
    const body = request.body as {
      title?: string;
      originalTitle?: string;
      imdbId?: string;
      seasonNumber?: number;
      episodeNumber?: number;
      episodeTitle?: string;
      filename?: string;
      embedded?: string[];
    } | null;

    const embedded = Array.isArray(body?.embedded)
      ? body.embedded.filter((url): url is string => typeof url === 'string' && Boolean(url))
      : [];

    const embeddedSubtitles = embedded.map((url, index) => ({
      id: `embedded-${index}`,
      provider: 'embedded',
      label: `Embedded subtitle ${index + 1}`,
      language: 'und',
      url
    }));

    return reply.send({
      configured: true,
      subtitles: embeddedSubtitles,
      message: embeddedSubtitles.length > 0
        ? 'Using subtitle URLs bundled with the resolved stream.'
        : 'No external subtitle URLs were provided. Embedded MKV tracks are handled directly by the player when exposed.'
    });
  });

  fastify.get('/track', async (request, reply) => {
    const { url } = request.query as { url?: string };

    if (!url) {
      return reply.code(400).send({ error: 'Missing subtitle URL' });
    }

    try {
      const response = await fetch(url);
      if (!response.ok) {
        return reply.code(response.status).send({ error: `Subtitle fetch failed with ${response.status}` });
      }

      const contentType = response.headers.get('content-type') || '';
      const rawText = await response.text();
      const isVtt = /text\/vtt/i.test(contentType) || /\.vtt(?:$|\?)/i.test(url);
      const subtitleText = isVtt
        ? rawText
        : looksLikeSrt(rawText)
        ? convertSrtToVtt(rawText)
        : rawText;

      reply.header('Content-Type', 'text/vtt; charset=utf-8');
      reply.header('Cache-Control', 'public, max-age=300');
      return reply.send(subtitleText);
    } catch (error) {
      request.log.error({ err: error, url }, 'Unable to proxy subtitle track');
      return reply.code(500).send({ error: 'Unable to proxy subtitle track' });
    }
  });
}
