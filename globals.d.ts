// noinspection ES6UnusedImports
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { App } from 'homey';

declare module 'homey' {
  export interface App {
    cleanupLogs(prefix: string): void;
  }
}
