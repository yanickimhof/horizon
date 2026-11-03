import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { apiMiddleware } from './server/api';
import { decide } from './server/access';

type Mw = (req: IncomingMessage, res: ServerResponse, next: () => void) => void | Promise<void>;
type Host = { middlewares: { use: (fn: Mw) => void } };

/** Garde d'accès: refuse avant toute route, y compris les fichiers statiques. */
const guard: Mw = (req, res, next) => {
  const d = decide(req);
  if (d.ok) return next();
  res.statusCode = d.status;
  res.setHeader('content-type', 'text/plain; charset=utf-8');
  res.end(d.reason ?? 'Accès refusé');
};

/** L'API locale tourne dans le même processus que Vite: une seule commande, aucun service externe. */
const horizonApi = () => ({
  name: 'horizon-api',
  configureServer(server: Host) {
    server.middlewares.use(guard);
    server.middlewares.use(apiMiddleware);
  },
  configurePreviewServer(server: Host) {
    server.middlewares.use(guard);
    server.middlewares.use(apiMiddleware);
  },
});

// Le serveur n'écoute que sur cet ordinateur. Tailscale Serve relaie les autres appareils vers ce port.
const HOSTS = ['.ts.net', 'localhost', '127.0.0.1'];

export default defineConfig({
  plugins: [react(), horizonApi()],
  server: { host: '127.0.0.1', allowedHosts: HOSTS },
  preview: { host: '127.0.0.1', port: 5173, strictPort: true, allowedHosts: HOSTS },
  test: { include: ['src/**/*.test.ts', 'server/**/*.test.ts'] },
});
