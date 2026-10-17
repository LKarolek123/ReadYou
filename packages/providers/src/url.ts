/**
 * Kanoniczny adres treści: ten sam artykuł z różnymi parametrami śledzącymi,
 * fragmentem czy wielkością liter w hoście ma jeden klucz w bazie.
 */

const TRACKING_PARAMS = new Set([
  'fbclid', 'gclid', 'dclid', 'gbraid', 'wbraid', 'msclkid', 'mc_cid', 'mc_eid', 'igshid', 'yclid',
  '_hsenc', '_hsmi', 'mkt_tok', 'ref', 'ref_src', 'ref_url', 'cmpid', 'ito', 'src', 'share', 'via',
  'srsltid', 'ocid', 'ns_mchannel', 'ns_source', 'ns_campaign', 'ns_linkname', 'ns_fee',
]);

export function canonicalizeUrl(input: string): string {
  const url = new URL(input);
  url.hash = '';
  url.username = '';
  url.password = '';
  url.hostname = url.hostname.toLowerCase().replace(/\.$/, '');
  if ((url.protocol === 'https:' && url.port === '443') || (url.protocol === 'http:' && url.port === '80')) url.port = '';
  const kept = [...url.searchParams.entries()]
    .filter(([k]) => {
      const key = k.toLowerCase();
      return !key.startsWith('utm_') && !key.startsWith('pk_') && !TRACKING_PARAMS.has(key);
    })
    .sort(([a], [b]) => a.localeCompare(b));
  url.search = new URLSearchParams(kept).toString();
  // Końcowy ukośnik nie zmienia treści artykułu (poza samym korzeniem).
  if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/+$/, '');
  return url.toString();
}

/** Domena źródła bez `www.` — do grupowania i atrybucji. */
export function sourceDomain(input: string): string {
  return new URL(input).hostname.toLowerCase().replace(/^www\./, '');
}
