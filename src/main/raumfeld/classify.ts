import type { DeviceRole } from '../../shared/types';
import type { ParsedDescription } from '../upnp/description';

/**
 * Decide what a fetched device description is. Returns null for anything that must be ignored.
 * A MediaServer/MediaRenderer is NEVER accepted on type alone (FRITZ!Box, Plex, ... exist):
 * the description must carry the Teufel/Raumfeld marker.
 */
export function classify(d: ParsedDescription): DeviceRole | null {
  if (!d.isRaumfeld) return null;
  if (/device:MediaRenderer:/i.test(d.deviceType)) return 'renderer';
  if (/device:MediaServer:/i.test(d.deviceType)) return 'mediaserver';
  if (/device:ConfigDevice:/i.test(d.deviceType)) return 'config';
  return null; // RaumfeldDevice (setup/provisioning) and anything else
}
