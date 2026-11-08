import { asArray, text, xml } from './xml';

export interface ParsedService {
  serviceType: string;
  controlUrl: string;
  eventSubUrl?: string;
  scpdUrl?: string;
}

export interface ParsedDescription {
  udn: string;
  deviceType: string;
  friendlyName: string;
  manufacturer: string;
  modelName: string;
  modelDescription: string;
  /** True when the description carries Raumfeld/Teufel markers. */
  isRaumfeld: boolean;
  services: ParsedService[];
}

/** Accept only well-formed http(s) URLs with a host (drops e.g. a bare "192.168.178.32"). */
export function validLocation(loc: string | undefined): URL | null {
  if (!loc) return null;
  try {
    const u = new URL(loc.trim());
    if ((u.protocol !== 'http:' && u.protocol !== 'https:') || !u.hostname) return null;
    return u;
  } catch {
    return null;
  }
}

export function resolveUrl(base: string, rel: string | undefined): string | undefined {
  if (!rel) return undefined;
  try {
    return new URL(rel, base).toString();
  } catch {
    return undefined;
  }
}

export function shortServiceName(serviceType: string): string {
  // urn:schemas-upnp-org:service:RenderingControl:1 -> RenderingControl
  const parts = serviceType.split(':');
  return parts.length >= 2 ? parts[parts.length - 2] : serviceType;
}

export function parseDescription(body: string, location: string): ParsedDescription | null {
  let doc: any;
  try {
    doc = xml.parse(body);
  } catch {
    return null;
  }
  const dev = doc?.root?.device;
  if (!dev) return null;
  const udn = String(text(dev.UDN) ?? '').replace(/^uuid:/i, '');
  if (!udn) return null;
  const deviceType = String(text(dev.deviceType) ?? '');
  const manufacturer = String(text(dev.manufacturer) ?? '');
  const marker = dev.protocolVersion !== undefined || dev.hardwareType !== undefined;
  const isRaumfeld =
    marker || /schemas-raumfeld-com/i.test(deviceType) || /teufel|raumfeld/i.test(manufacturer);
  const services: ParsedService[] = asArray<any>(dev.serviceList?.service).flatMap((s) => {
    const controlUrl = resolveUrl(location, text(s.controlURL));
    if (!controlUrl) return [];
    return [
      {
        serviceType: String(text(s.serviceType) ?? ''),
        controlUrl,
        eventSubUrl: resolveUrl(location, text(s.eventSubURL)),
        scpdUrl: resolveUrl(location, text(s.SCPDURL)),
      },
    ];
  });
  return {
    udn,
    deviceType,
    friendlyName: String(text(dev.friendlyName) ?? ''),
    manufacturer,
    modelName: String(text(dev.modelName) ?? ''),
    modelDescription: String(text(dev.modelDescription) ?? ''),
    isRaumfeld,
    services,
  };
}
