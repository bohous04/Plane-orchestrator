import { describe, it, expect } from "vitest";
import { PortPool } from "../src/pool.js";

describe("PortPool", () => {
  it("acquires immediately when ports are available", async () => {
    const p = new PortPool([3000, 3001, 3002]);
    const a = await p.acquire();
    const b = await p.acquire();
    expect(a).not.toBe(b);
    expect(p.inUseCount()).toBe(2);
    expect(p.availableCount()).toBe(1);
  });

  it("blocks when exhausted and unblocks on release", async () => {
    const p = new PortPool([5000]);
    const first = await p.acquire();
    let secondResolved = false;
    const secondPromise = p.acquire().then((port) => {
      secondResolved = true;
      return port;
    });
    await new Promise((r) => setTimeout(r, 10));
    expect(secondResolved).toBe(false);
    p.release(first);
    const second = await secondPromise;
    expect(second).toBe(5000);
    expect(p.inUseCount()).toBe(1);
  });

  it("serves waiters in FIFO order", async () => {
    const p = new PortPool([7000]);
    const held = await p.acquire();
    const order: number[] = [];
    const w1 = p.acquire().then((port) => {
      order.push(1);
      p.release(port);
    });
    const w2 = p.acquire().then((port) => {
      order.push(2);
      p.release(port);
    });
    const w3 = p.acquire().then((port) => {
      order.push(3);
      p.release(port);
    });
    p.release(held);
    await Promise.all([w1, w2, w3]);
    expect(order).toEqual([1, 2, 3]);
  });

  it("rejects unknown ports on release", async () => {
    const p = new PortPool([8000]);
    expect(() => p.release(9999)).toThrow();
  });

  it("ignores release of a port that wasn't acquired", async () => {
    const p = new PortPool([8000, 8001]);
    expect(() => p.release(8000)).not.toThrow();
  });

  it("rejects empty port list", () => {
    expect(() => new PortPool([])).toThrow();
  });

  it("rejects duplicate ports", () => {
    expect(() => new PortPool([3000, 3000])).toThrow();
  });

  it("size + counts are accurate", async () => {
    const p = new PortPool([10, 20, 30]);
    expect(p.size()).toBe(3);
    expect(p.availableCount()).toBe(3);
    expect(p.inUseCount()).toBe(0);
    const a = await p.acquire();
    expect(p.availableCount()).toBe(2);
    expect(p.inUseCount()).toBe(1);
    p.release(a);
    expect(p.availableCount()).toBe(3);
    expect(p.inUseCount()).toBe(0);
  });

  it("recycles released ports under high concurrency", async () => {
    const p = new PortPool([1, 2, 3]);
    const seen = new Set<number>();
    await Promise.all(
      Array.from({ length: 50 }).map(async () => {
        const port = await p.acquire();
        seen.add(port);
        await new Promise((r) => setTimeout(r, 1));
        p.release(port);
      }),
    );
    expect(seen).toEqual(new Set([1, 2, 3]));
    expect(p.inUseCount()).toBe(0);
  });
});
