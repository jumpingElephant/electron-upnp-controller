import os from 'node:os';
import type { InterfaceInfo } from '../../shared/types';

const SKIP =
  /^(lo|docker\d*|veth.*|br-.*|virbr.*|tun\d*|tap\d*|vboxnet.*|vmnet.*|vEthernet.*|utun\d*|awdl\d*|llw\d*|bridge\d*|anpi\d*)$/;

export function listCandidateInterfaces(
  nets: NodeJS.Dict<os.NetworkInterfaceInfo[]> = os.networkInterfaces(),
): InterfaceInfo[] {
  const out: InterfaceInfo[] = [];
  for (const [name, addrs] of Object.entries(nets)) {
    if (SKIP.test(name)) continue;
    for (const a of addrs ?? []) {
      if (a.family === 'IPv4' && !a.internal) {
        out.push({ name, address: a.address, netmask: a.netmask });
      }
    }
  }
  return out;
}

export function ipToInt(ip: string): number {
  return ip.split('.').reduce((acc, p) => ((acc << 8) | Number(p)) >>> 0, 0) >>> 0;
}

export function sameSubnet(a: string, b: string, mask: string): boolean {
  const m = ipToInt(mask);
  return (ipToInt(a) & m) >>> 0 === (ipToInt(b) & m) >>> 0;
}

/** Which of our interfaces can reach `ip` directly? */
export function interfaceFor(ip: string, ifaces: InterfaceInfo[]): InterfaceInfo | undefined {
  return ifaces.find((i) => sameSubnet(ip, i.address, i.netmask));
}

export function sameInterfaceSet(a: InterfaceInfo[], b: InterfaceInfo[]): boolean {
  const key = (l: InterfaceInfo[]) =>
    l
      .map((i) => `${i.name}/${i.address}`)
      .sort()
      .join(',');
  return key(a) === key(b);
}
