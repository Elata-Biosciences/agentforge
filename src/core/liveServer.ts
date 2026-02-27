import { WebSocket, WebSocketServer } from 'ws';

export type LiveEventV1 =
  | { v: 'v1'; type: 'simulation_start'; ts: number; payload: Record<string, unknown> }
  | { v: 'v1'; type: 'tick_start'; ts: number; payload: { tick: number; timestamp: number } }
  | { v: 'v1'; type: 'tick_end'; ts: number; payload: { tick: number; timestamp: number } }
  | { v: 'v1'; type: 'action'; ts: number; payload: Record<string, unknown> }
  | { v: 'v1'; type: 'metric_sample'; ts: number; payload: Record<string, unknown> }
  | { v: 'v1'; type: 'gossip_post'; ts: number; payload: Record<string, unknown> }
  | { v: 'v1'; type: 'gossip_deliver'; ts: number; payload: Record<string, unknown> }
  | { v: 'v1'; type: 'simulation_end'; ts: number; payload: Record<string, unknown> };

export interface LiveServer {
  url: string;
  broadcast: (event: Omit<LiveEventV1, 'v' | 'ts'> & { payload: any }) => void;
  close: () => Promise<void>;
}

export function createLiveServer(options: {
  host?: string;
  port?: number;
  logger?: { info: (obj: any, msg?: string) => void; warn: (obj: any, msg?: string) => void };
}): LiveServer {
  const host = options.host ?? 'localhost';
  const requestedPort = options.port ?? 8787;

  const wss = new WebSocketServer({ host, port: requestedPort });
  const RECENT_MAX = 2000;
  let lastSimulationStart: LiveEventV1 | null = null;
  const recentEvents: LiveEventV1[] = [];
  let actualPort = requestedPort;
  try {
    const addr = wss.address();
    if (addr && typeof addr !== 'string') {
      actualPort = addr.port;
    }
  } catch {
    // ignore
  }
  const url = `ws://${host}:${actualPort}`;

  options.logger?.info({ url }, 'Live websocket server started');

  wss.on('connection', (ws: WebSocket) => {
    ws.send(
      JSON.stringify({
        v: 'v1',
        type: 'hello',
        ts: Date.now(),
        payload: { url },
      })
    );
    // Late-attach support: replay the last simulation start and a small buffer of recent events
    // so the UI can attach mid-run and still build state.
    if (lastSimulationStart) {
      try {
        ws.send(JSON.stringify(lastSimulationStart));
      } catch {
        // ignore
      }
    }
    for (const ev of recentEvents) {
      try {
        ws.send(JSON.stringify(ev));
      } catch {
        // ignore
      }
    }
  });

  function broadcast(event: Omit<LiveEventV1, 'v' | 'ts'> & { payload: any }): void {
    const full = { v: 'v1', ts: Date.now(), ...event } as LiveEventV1;
    if (full.type === 'simulation_start') {
      lastSimulationStart = full;
      recentEvents.length = 0;
    } else if (
      full.type === 'tick_start' ||
      full.type === 'tick_end' ||
      full.type === 'action' ||
      full.type === 'metric_sample' ||
      full.type === 'gossip_post' ||
      full.type === 'gossip_deliver' ||
      full.type === 'simulation_end'
    ) {
      recentEvents.push(full);
      if (recentEvents.length > RECENT_MAX) {
        recentEvents.splice(0, recentEvents.length - RECENT_MAX);
      }
    }

    const msg = JSON.stringify(full);
    for (const client of wss.clients) {
      if (client.readyState !== WebSocket.OPEN) continue;
      try {
        client.send(msg);
      } catch (err) {
        options.logger?.warn({ err }, 'Live websocket send failed');
      }
    }
  }

  async function close(): Promise<void> {
    await new Promise<void>((resolve) => wss.close(() => resolve()));
    options.logger?.info({ url }, 'Live websocket server stopped');
  }

  return { url, broadcast, close };
}
