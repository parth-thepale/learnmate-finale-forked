import http from 'http';
import type { AddressInfo } from 'net';
import type { Express } from 'express';

/** Starts an Express app on an ephemeral localhost port for HTTP-level tests. */
export async function withTestServer<T>(app: Express, run: (baseUrl: string) => Promise<T>): Promise<T> {
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  try {
    return await run(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}
