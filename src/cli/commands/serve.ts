import { spawn } from 'node:child_process';
import { readFile, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';
import { Command } from 'commander';
import { output } from '../ui/output.js';

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

export const serveCommand = new Command('serve')
  .description('Serve a run dashboard locally (for file://-unfriendly browsers)')
  .argument('<runDir>', 'Run directory containing dashboard/ output')
  .option('--host <host>', 'Host/interface to bind', '127.0.0.1')
  .option(
    '--port <port>',
    'Port to bind (0 = random free port)',
    (v) => Number.parseInt(v, 10),
    8788
  )
  .option('--open', 'Open in default browser (macOS: open)')
  .option('--check', 'Start server, self-check one request, then exit')
  .action(async (runDir, options) => {
    const runPath = resolve(process.cwd(), runDir);
    const dashDir = join(runPath, 'dashboard');

    try {
      const info = await stat(dashDir);
      if (!info.isDirectory()) {
        throw new Error('dashboard path is not a directory');
      }
    } catch {
      output.error(`Missing dashboard directory: ${dashDir}`);
      output.info('Run: forge-sim dashboard <runDir>');
      process.exit(2);
    }

    const host = String(options.host);
    const port = Number(options.port);
    const check = Boolean(options.check);
    const openBrowser = Boolean(options.open);

    const server = createServer(async (req, res) => {
      try {
        const url = new URL(req.url ?? '/', `http://${host}:${port || 80}`);
        const rawPath = url.pathname === '/' ? '/index.html' : url.pathname;
        const safePath = normalize(rawPath).replaceAll('\\', '/');
        if (!safePath.startsWith('/')) {
          res.statusCode = 400;
          res.end('Bad Request');
          return;
        }
        if (safePath.includes('..')) {
          res.statusCode = 400;
          res.end('Bad Request');
          return;
        }

        const abs = join(dashDir, safePath);
        const fileInfo = await stat(abs);
        if (!fileInfo.isFile()) {
          res.statusCode = 404;
          res.end('Not Found');
          return;
        }

        const body = await readFile(abs);
        const ext = extname(abs).toLowerCase();
        res.setHeader('Content-Type', CONTENT_TYPES[ext] ?? 'application/octet-stream');
        res.statusCode = 200;
        res.end(body);
      } catch {
        res.statusCode = 404;
        res.end('Not Found');
      }
    });

    await new Promise<void>((resolve, reject) => {
      server.on('error', (err) => reject(err));
      server.listen(port, host, () => resolve());
    });

    const addr = server.address();
    const actualPort = addr && typeof addr !== 'string' ? addr.port : port;
    const url = `http://${host}:${actualPort}/`;

    output.success(`Serving dashboard: ${url}`);
    output.info(`Root: ${dashDir}`);
    output.newline();

    if (openBrowser) {
      try {
        spawn('open', [url], { stdio: 'ignore', detached: true }).unref();
      } catch {
        // best-effort
      }
    }

    if (check) {
      const { request } = await import('node:http');
      await new Promise<void>((resolve, reject) => {
        const req = request(url, (resp) => {
          const ok = resp.statusCode === 200;
          resp.resume();
          resp.on('end', () => (ok ? resolve() : reject(new Error(`HTTP ${resp.statusCode}`))));
        });
        req.on('error', reject);
        req.end();
      });
      await new Promise<void>((resolve) => server.close(() => resolve()));
      process.exit(0);
    }

    // Keep process alive.
  });
