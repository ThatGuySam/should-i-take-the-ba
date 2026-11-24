import { type Direction, STRETCH_BOUNDARIES } from "./config";
import type { Reading } from "./core/verdict";

/** Per-stretch durations, eastbound order regardless of direction. Used in memory only, never stored. */
export type StretchReading = { durationSec: number; staticDurationSec: number };

export type TrafficResult =
  | { ok: true; reading: Reading; provider: string; stretches?: StretchReading[] }
  | { ok: false; error: string; provider: string };

const ROUTES_URL = "https://routes.googleapis.com/directions/v2:computeRoutes";
const FIELD_MASK = "routes.duration,routes.staticDuration,routes.distanceMeters,routes.legs.duration,routes.legs.staticDuration,fallbackInfo";
// The route is about 25.6 km. With stretch waypoints, a much longer route means a waypoint snapped
// to the wrong road; then the reading is discarded and stretches are turned off.
const MAX_ROUTE_METERS = 27_000;

const seconds = (value: unknown): number => {
  if (typeof value !== "string" || !value.endsWith("s")) return Number.NaN;
  return Number.parseFloat(value.slice(0, -1));
};

type RoutesResponse = {
  routes?: Array<{
    duration?: string;
    staticDuration?: string;
    distanceMeters?: number;
    legs?: Array<{ duration?: string; staticDuration?: string }>;
  }>;
  fallbackInfo?: { routingMode?: string; reason?: string };
  error?: { message?: string; status?: string };
};

export async function fetchGoogleRoutes(direction: Direction, apiKey: string, now: Date, withStretches = false): Promise<TrafficResult> {
  const westbound = direction.id === "westbound";
  const boundaries = westbound ? [...STRETCH_BOUNDARIES].reverse() : [...STRETCH_BOUNDARIES];
  const intermediates = withStretches
    ? boundaries.map((b) => ({ location: { latLng: { latitude: b.lat, longitude: b.lng }, heading: (b.heading + (westbound ? 180 : 0)) % 360 } }))
    : undefined;
  const provider = "google-routes";
  const response = await fetch(ROUTES_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask": FIELD_MASK,
    },
    body: JSON.stringify({
      origin: { location: { latLng: { latitude: direction.origin.lat, longitude: direction.origin.lng } } },
      destination: {
        location: { latLng: { latitude: direction.destination.lat, longitude: direction.destination.lng } },
      },
      ...(intermediates ? { intermediates } : {}),
      travelMode: "DRIVE",
      routingPreference: "TRAFFIC_AWARE_OPTIMAL",
      computeAlternativeRoutes: false,
    }),
  });

  const body = (await response.json().catch(() => ({}))) as RoutesResponse;
  if (!response.ok) {
    return { ok: false, provider, error: `HTTP ${response.status}: ${body.error?.status ?? "unknown"}` };
  }
  if (body.fallbackInfo?.routingMode === "FALLBACK_TRAFFIC_UNAWARE") {
    return { ok: false, provider, error: `traffic-unaware fallback (${body.fallbackInfo.reason ?? "no reason"})` };
  }
  const route = body.routes?.[0];
  const durationSec = seconds(route?.duration);
  const staticDurationSec = seconds(route?.staticDuration);
  if (!route || !(durationSec > 0) || !(staticDurationSec > 0)) {
    return { ok: false, provider, error: "response had no usable route durations" };
  }
  if (withStretches && (route.distanceMeters ?? 0) > MAX_ROUTE_METERS) {
    return { ok: false, provider, error: `stretch waypoints gave a ${route.distanceMeters} m route` };
  }
  let stretches: StretchReading[] | undefined;
  if (withStretches && route.legs?.length === STRETCH_BOUNDARIES.length + 1) {
    const legs = route.legs.map((l) => ({ durationSec: seconds(l.duration), staticDurationSec: seconds(l.staticDuration) }));
    if (legs.every((l) => l.durationSec > 0 && l.staticDurationSec > 0)) stretches = westbound ? legs.reverse() : legs;
  }
  return {
    ok: true,
    provider,
    stretches,
    reading: {
      at: now.toISOString(),
      durationSec,
      staticDurationSec,
      distanceMeters: route.distanceMeters ?? 0,
    },
  };
}

type DirectionsResponse = {
  status?: string;
  error_message?: string;
  routes?: Array<{ legs?: Array<{ duration?: { value?: number }; duration_in_traffic?: { value?: number }; distance?: { value?: number } }> }>;
};

// Directions (Legacy) still works for projects that already had it enabled, which includes the
// old site's key. Used only when Routes is denied for the key. `duration` there is the trip time
// without live traffic; `duration_in_traffic` needs departure_time.
export async function fetchGoogleDirections(direction: Direction, apiKey: string, now: Date): Promise<TrafficResult> {
  const provider = "google-directions";
  const url = new URL("https://maps.googleapis.com/maps/api/directions/json");
  url.searchParams.set("origin", `${direction.origin.lat},${direction.origin.lng}`);
  url.searchParams.set("destination", `${direction.destination.lat},${direction.destination.lng}`);
  url.searchParams.set("mode", "driving");
  url.searchParams.set("departure_time", "now");
  url.searchParams.set("traffic_model", "best_guess");
  url.searchParams.set("key", apiKey);
  const response = await fetch(url);
  const body = (await response.json().catch(() => ({}))) as DirectionsResponse;
  if (!response.ok || body.status !== "OK") {
    return { ok: false, provider, error: `HTTP ${response.status}: ${body.status ?? "unknown"}` };
  }
  const leg = body.routes?.[0]?.legs?.[0];
  const durationSec = leg?.duration_in_traffic?.value ?? Number.NaN;
  const staticDurationSec = leg?.duration?.value ?? Number.NaN;
  if (!(durationSec > 0) || !(staticDurationSec > 0)) {
    return { ok: false, provider, error: "response had no usable traffic duration" };
  }
  return {
    ok: true,
    provider,
    reading: { at: now.toISOString(), durationSec, staticDurationSec, distanceMeters: leg?.distance?.value ?? 0 },
  };
}

export async function fetchTraffic(
  direction: Direction,
  env: { TRAFFIC_PROVIDER?: string; GOOGLE_MAPS_API_KEY?: string },
  now: Date,
  withStretches = false,
): Promise<TrafficResult> {
  const provider = env.TRAFFIC_PROVIDER ?? "google-routes";
  if (provider === "google-routes") {
    if (!env.GOOGLE_MAPS_API_KEY) return { ok: false, provider, error: "GOOGLE_MAPS_API_KEY is not set" };
    const routes = await fetchGoogleRoutes(direction, env.GOOGLE_MAPS_API_KEY, now, withStretches);
    if (routes.ok || !routes.error.startsWith("HTTP 403")) return routes;
    const legacy = await fetchGoogleDirections(direction, env.GOOGLE_MAPS_API_KEY, now);
    return legacy.ok ? legacy : { ...legacy, error: `routes ${routes.error}; directions ${legacy.error}` };
  }
  return { ok: false, provider, error: `unknown provider ${provider}` };
}
