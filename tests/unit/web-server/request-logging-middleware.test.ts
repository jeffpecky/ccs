import { describe, expect, it, mock } from 'bun:test';
import { EventEmitter } from 'events';

const info = mock(() => {});
mock.module('../../../src/services/logging', () => ({
  createLogger: () => ({
    child: () => ({}),
    debug: () => {},
    info,
    warn: () => {},
    error: () => {},
    stage: () => {},
  }),
}));

const { requestLoggingMiddleware } = await import(
  '../../../src/web-server/middleware/request-logging-middleware'
);

describe('request logging middleware', () => {
  it('does not run structured logging for Bar health readiness probes', () => {
    const req = {
      method: 'GET',
      originalUrl: '/api/bar/health',
      socket: { remoteAddress: '127.0.0.1' },
      headers: {},
    } as any;
    const res = Object.assign(new EventEmitter(), {
      locals: {},
      statusCode: 200,
      setHeader: () => {},
    }) as any;

    requestLoggingMiddleware(req, res, () => {});
    res.emit('finish');

    expect(info).not.toHaveBeenCalled();
  });
});
