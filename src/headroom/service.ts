export function isLoopbackHeadroomUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === 'http:' &&
      ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname.toLowerCase())
    );
  } catch {
    return false;
  }
}

export function getHeadroomEndpoint(value: string): { port: number } {
  const url = new URL(value);
  if (
    !isLoopbackHeadroomUrl(value) ||
    (url.pathname !== '/' && url.pathname !== '') ||
    url.search ||
    url.hash
  ) {
    throw new Error('Managed Headroom URL must be a loopback HTTP origin without a path.');
  }
  const port = Number(url.port || 80);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('Invalid Headroom port.');
  }
  return { port };
}
