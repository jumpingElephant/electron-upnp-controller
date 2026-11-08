import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { describe, expect, it } from 'vitest';
import { Discovery } from '../src/main/raumfeld/discovery';
import { fixture } from './helpers';

/** A speaker's description endpoint on an ephemeral port (they change on every reboot). */
async function speaker(file: string) {
  const server = http.createServer((_req, res) =>
    res.writeHead(200, { 'Content-Type': 'text/xml' }).end(fixture(file)),
  );
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const stop = () => new Promise<void>((r) => server.close(() => r()));
  return { base, stop };
}

describe('reconnecting after the speaker was unplugged', () => {
  it('drops the dead speaker and accepts it again under a new port', async () => {
    const d = new Discovery();
    d.on('log', () => {});
    const before = await speaker('renderer.xml');
    expect((await d.addManual(`${before.base}/x.xml`)).ok).toBe(true);
    expect(d.targets()).toHaveLength(1);
    const udn = d.targets()[0].udn;

    await d.checkHealth();
    expect(d.targets()).toHaveLength(1); // healthy: stays

    await before.stop(); // unplugged: no byebye, just silence
    await d.checkHealth();
    expect(d.targets()).toHaveLength(1); // one failed probe is tolerated (wifi blip)
    await d.checkHealth();
    expect(d.targets()).toHaveLength(0); // second one drops it

    const after = await speaker('renderer.xml'); // same UDN, new port
    expect((await d.addManual(`${after.base}/x.xml`)).ok).toBe(true);
    expect(d.targets().map((t) => t.udn)).toEqual([udn]);
    expect(d.getDevice(udn)?.location).toContain(after.base);

    // The same URL announcing itself again after a drop must not be ignored (stale location cache).
    await after.stop();
    await d.checkHealth();
    await d.checkHealth();
    expect(d.targets()).toHaveLength(0);
    const again = await speaker('renderer.xml');
    expect((await d.addManual(`${again.base}/x.xml`)).ok).toBe(true);
    expect(d.targets()).toHaveLength(1);
    await again.stop();
  }, 20000);
});
