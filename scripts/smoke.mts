/**
 * Headless smoke test against real hardware (no Electron).
 *   npm run smoke                 discover + read state + list favorites
 *   npm run smoke -- --play       also play the first favorite for ~8s, then stop
 *   npm run smoke -- --iface wlan0
 */
import { Discovery } from '../src/main/raumfeld/discovery.ts';
import { Controller } from '../src/main/raumfeld/controller.ts';

const args = process.argv.slice(2);
const iface = args.includes('--iface') ? args[args.indexOf('--iface') + 1] : 'auto';

const d = new Discovery();
d.on('log', (m: string) => console.log('[log]', m));
await d.start(iface);
await new Promise((r) => setTimeout(r, 6000));

const targets = d.targets();
console.log('targets:', targets);
if (targets.length === 0) {
  console.error('No speaker found');
  d.stop();
  process.exit(1);
}
const c = new Controller(d);
const t = targets[0].udn;
console.log('state:', await c.getState(t));
const favs = await c.listFavorites(t, '0/Favorites/MyFavorites');
console.log(
  'favorites:',
  favs.map((f) => `${f.id} ${f.title}`),
);
if (args.includes('--play') && favs[0]) {
  console.log('playing', favs[0].title);
  await c.playFavorite(t, favs[0].id);
  for (let i = 0; i < 4; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    console.log('state:', await c.getState(t));
  }
  await c.stop(t);
  console.log('stopped; state:', await c.getState(t));
}
d.stop();
process.exit(0);
