export interface SseEvent {
  event: string;
  data?: unknown;
  raw?: string;
}

/** Parses one Server-Sent Events frame into its event type and JSON data. */
export const parseFrame = (frame: string): SseEvent => {
  let event = 'message';
  const dataLines: string[] = [];
  frame.split('\n').forEach((line) => {
    if (line.startsWith(':')) return; // comment
    if (line.startsWith('event:')) event = line.slice(6).trim();
    else if (line.startsWith('data:'))
      dataLines.push(line.slice(5).replace(/^ /, ''));
  });
  const text = dataLines.join('\n');
  if (text === '') return { event };
  try {
    return { event, data: JSON.parse(text) };
  } catch (e) {
    return { event, raw: text };
  }
};

/** Turns stream text, in arbitrary chunks, into complete events. */
export class SseParser {
  #buffer = '';

  push(text: string): SseEvent[] {
    // A CRLF can be split across chunks, so normalise the joined buffer rather than each chunk
    this.#buffer = (this.#buffer + text).replace(/\r\n/g, '\n');
    const events: SseEvent[] = [];
    let end = this.#buffer.indexOf('\n\n');
    while (end !== -1) {
      events.push(parseFrame(this.#buffer.slice(0, end)));
      this.#buffer = this.#buffer.slice(end + 2);
      end = this.#buffer.indexOf('\n\n');
    }
    return events;
  }
}
