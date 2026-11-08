import { escapeXml, xml } from './xml';

export class SoapFault extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly action: string,
  ) {
    super(`${action} failed: ${message} (${code})`);
    this.name = 'SoapFault';
  }
}

export class SoapNetworkError extends Error {
  constructor(action: string, cause: unknown) {
    super(`${action}: network error: ${cause instanceof Error ? cause.message : String(cause)}`);
    this.name = 'SoapNetworkError';
  }
}

export function buildEnvelope(
  serviceType: string,
  action: string,
  args: Record<string, string | number | boolean>,
): string {
  const body = Object.entries(args)
    .map(([k, v]) => `<${k}>${escapeXml(String(v))}</${k}>`)
    .join('');
  return (
    '<?xml version="1.0" encoding="utf-8"?>' +
    '<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" ' +
    's:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/"><s:Body>' +
    `<u:${action} xmlns:u="${serviceType}">${body}</u:${action}>` +
    '</s:Body></s:Envelope>'
  );
}

/** Parse a SOAP response body; throws SoapFault on a fault. Returns the action response's fields. */
export function parseResponse(action: string, body: string): Record<string, string> {
  let doc: any;
  try {
    doc = xml.parse(body);
  } catch (e) {
    throw new Error(`${action}: unparsable SOAP response: ${(e as Error).message}`, { cause: e });
  }
  const b = doc?.Envelope?.Body;
  if (!b) throw new Error(`${action}: response has no SOAP body`);
  if (b.Fault) {
    const err = b.Fault.detail?.UPnPError ?? {};
    throw new SoapFault(
      String(err.errorCode ?? b.Fault.faultcode ?? '?'),
      String(err.errorDescription ?? b.Fault.faultstring ?? 'SOAP fault'),
      action,
    );
  }
  const resp = b[`${action}Response`];
  const out: Record<string, string> = {};
  if (resp && typeof resp === 'object') {
    for (const [k, v] of Object.entries(resp)) {
      if (k.startsWith('@_')) continue;
      out[k] = typeof v === 'string' ? v : '';
    }
  }
  return out;
}

export interface SoapOptions {
  timeoutMs?: number;
  /** Retries on network error / timeout only (never on faults). */
  retries?: number;
}

export async function callSoap(
  controlUrl: string,
  serviceType: string,
  action: string,
  args: Record<string, string | number | boolean> = {},
  opts: SoapOptions = {},
): Promise<Record<string, string>> {
  const { timeoutMs = 5000, retries = 1 } = opts;
  const payload = buildEnvelope(serviceType, action, args);
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    let res: Response;
    let text: string;
    try {
      res = await fetch(controlUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'text/xml; charset="utf-8"',
          SOAPACTION: `"${serviceType}#${action}"`,
        },
        body: payload,
        signal: AbortSignal.timeout(timeoutMs),
      });
      text = await res.text();
    } catch (e) {
      lastErr = e;
      continue;
    }
    // UPnP faults come back as HTTP 500 with a SOAP fault body.
    if (!res.ok && !text.includes('Fault')) {
      throw new Error(`${action}: HTTP ${res.status}`);
    }
    return parseResponse(action, text);
  }
  throw new SoapNetworkError(action, lastErr);
}
