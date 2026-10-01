// The ordering rules behind the View's file-backed source: which in-flight
// read or write may still change what the View shows, and in what order
// writes reach the host. Kept out of View.vue so it can be tested without a
// WebGL canvas.

/** What an operation was started for: the generation at its start, and the
 *  result it belongs to. */
export interface SourceTicket {
  generation: number;
  key: string;
}

export class SourceSync {
  /** Bumped by everything that establishes what the source now IS. */
  private generation = 0;
  /** Settles when every write enqueued so far has settled. */
  private writes: Promise<unknown> = Promise.resolve();

  /** Something made every operation in flight stale: an edit in the box,
   *  another result shown in this View. */
  supersede(): void {
    this.generation++;
  }

  /** Start a read or write for the result `key` names. */
  begin(key: string): SourceTicket {
    return { generation: ++this.generation, key };
  }

  /** Whether an operation may still change the View: nothing was started or
   *  superseded since, and the View still shows the result it was for. A
   *  host may reuse one View for another result while a read is in flight,
   *  and that read must not land on the new one (gui-chat-plugins#16). */
  isCurrent(ticket: SourceTicket, key: string): boolean {
    return ticket.generation === this.generation && ticket.key === key;
  }

  /** Run `write` once every write enqueued before it has settled, failed ones
   *  included. Two Applies in quick succession then reach the host in order,
   *  so the later script is the one left on disk whatever order the host
   *  would have completed them in (gui-chat-plugins#15). */
  enqueue<T>(write: () => Promise<T>): Promise<T> {
    const run = this.writes.then(write);
    this.writes = run.catch(() => undefined);
    return run;
  }
}

/** The identity a View result is tracked by: its `uuid`, or failing that the
 *  file it is backed by. */
export function resultKey(result: {
  uuid?: string | undefined;
  data?: { filePath?: string | undefined } | undefined;
}): string {
  return result.uuid ?? result.data?.filePath ?? "";
}
