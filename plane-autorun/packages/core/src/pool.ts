// Async port pool: acquire() blocks until a port is free, release(port) returns it.
// FIFO fairness: waiters are served in the order they arrived.

export class PortPool {
  private readonly available: number[];
  private readonly waiters: Array<(port: number) => void> = [];
  private readonly all: ReadonlySet<number>;
  private readonly inUse = new Set<number>();

  constructor(ports: readonly number[]) {
    if (ports.length === 0) throw new Error("PortPool: must have at least one port");
    const unique = new Set(ports);
    if (unique.size !== ports.length) throw new Error("PortPool: ports must be unique");
    this.available = [...ports];
    this.all = unique;
  }

  size(): number {
    return this.all.size;
  }

  inUseCount(): number {
    return this.inUse.size;
  }

  availableCount(): number {
    return this.available.length;
  }

  async acquire(): Promise<number> {
    const port = this.available.shift();
    if (port !== undefined) {
      this.inUse.add(port);
      return port;
    }
    return new Promise<number>((resolve) => {
      this.waiters.push((p) => {
        this.inUse.add(p);
        resolve(p);
      });
    });
  }

  release(port: number): void {
    if (!this.all.has(port)) {
      throw new Error(`PortPool: ${port} not part of this pool`);
    }
    if (!this.inUse.has(port)) {
      // Idempotent — release of a non-held port is a no-op (e.g. cleanup paths).
      return;
    }
    this.inUse.delete(port);
    const next = this.waiters.shift();
    if (next) {
      // Pass the port directly to the waiter without round-tripping through `available`.
      next(port);
    } else {
      this.available.push(port);
    }
  }
}
