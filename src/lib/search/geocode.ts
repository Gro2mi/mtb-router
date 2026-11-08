/**
 * Place search (geocoding): Photon (komoot) primary — fuzzy autocomplete over
 * OSM data, free, no key — with Nominatim as fallback when the request fails.
 * Both are key-less OSM services; attribution stays OSM-only.
 */

export type GeoResult = {
  lng: number;
  lat: number;
  /** display label: primary name + region context */
  label: string;
};

const PHOTON_URL = 'https://photon.komoot.io/api/';
const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search';

function photonLabel(props: Record<string, unknown>): string {
  const parts: string[] = [];
  const name = props.name as string | undefined;
  for (const key of ['city', 'county', 'state', 'country']) {
    const v = props[key];
    if (typeof v === 'string' && v && v !== name) parts.push(v);
  }
  return name ? (parts.length ? `${name}, ${parts.join(', ')}` : name) : '???';
}

async function photon(q: string, lang: 'en' | 'de', signal: AbortSignal): Promise<GeoResult[]> {
  const url = `${PHOTON_URL}?q=${encodeURIComponent(q)}&limit=6&lang=${lang}`;
  const res = await fetch(url, { signal, headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`photon ${res.status}`);
  const json = (await res.json()) as {
    features: { geometry: { coordinates: [number, number] }; properties: Record<string, unknown> }[];
  };
  return json.features.map((f) => ({
    lng: f.geometry.coordinates[0]!,
    lat: f.geometry.coordinates[1]!,
    label: photonLabel(f.properties),
  }));
}

async function nominatim(q: string, signal: AbortSignal): Promise<GeoResult[]> {
  const url = `${NOMINATIM_URL}?q=${encodeURIComponent(q)}&format=jsonv2&limit=6&accept-language=de,en`;
  const res = await fetch(url, { signal, headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`nominatim ${res.status}`);
  const json = (await res.json()) as { lon: string; lat: string; display_name: string }[];
  return json.map((r) => ({
    lng: Number(r.lon),
    lat: Number(r.lat),
    label: r.display_name,
  }));
}

/** Photon first; on request failure (blocked/unreachable) fall back to Nominatim. */
export async function geocode(q: string, lang: 'en' | 'de', signal: AbortSignal): Promise<GeoResult[]> {
  try {
    return await photon(q, lang, signal);
  } catch (err) {
    if (signal.aborted) throw err;
    return await nominatim(q, signal);
  }
}
