import WebSocket from 'ws';
import { getUserAgent } from './newrelic-transaction';

export class UserAgentWebSocket extends WebSocket {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  constructor(address: string, protocols: any) {
    super(address, protocols, {
      headers: {
        'User-Agent': getUserAgent(),
      },
    });
  }
}
