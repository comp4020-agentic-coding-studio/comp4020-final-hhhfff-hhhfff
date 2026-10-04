// Shops within about 3.5 km of ANU, taken once from OpenStreetMap (Overpass,
// shop=supermarket|convenience|greengrocer around -35.2777,149.1185) and then
// edited by hand: petrol-station shops dropped, as was one with no name.
// There is no Woolworths within range, so its absence is not an omission.
// The list is static on purpose — no map API at runtime, nothing to rate-limit.
// Ids are stable: deals reference them, so never renumber or reuse one.

export type StoreKind = "supermarket" | "asian" | "convenience";

export interface Store {
  id: string;
  name: string;
  kind: StoreKind;
  where: string;
  lat: number;
  lon: number;
}

export const STORES: readonly Store[] = [
  { id: "coles-civic", name: "Coles", kind: "supermarket", where: "Bunda St, Civic", lat: -35.2783, lon: 149.1338 },
  { id: "aldi-civic", name: "Aldi", kind: "supermarket", where: "Bunda St, Civic", lat: -35.2791, lon: 149.1341 },
  { id: "iga-oconnor", name: "IGA", kind: "supermarket", where: "Sargood St, O'Connor", lat: -35.2642, lon: 149.1223 },
  { id: "iga-ainslie", name: "IGA", kind: "supermarket", where: "Edgar St, Ainslie", lat: -35.262, lon: 149.145 },
  { id: "iga-southeast", name: "IGA", kind: "supermarket", where: "south-east of Civic", lat: -35.2896, lon: 149.1541 },
  { id: "braddon-supermarket", name: "Braddon Supermarket", kind: "supermarket", where: "Lowanna St, Braddon", lat: -35.264, lon: 149.1328 },
  { id: "supaexpress-lyneham", name: "Lyneham Supaexpress", kind: "supermarket", where: "Wattle Pl, Lyneham", lat: -35.2521, lon: 149.1249 },
  { id: "daily-market-childers", name: "Daily Market", kind: "asian", where: "Childers St, Acton", lat: -35.2768, lon: 149.1255 },
  { id: "daily-market-groceries", name: "Daily Market Groceries", kind: "asian", where: "ANU campus", lat: -35.2775, lon: 149.1202 },
  { id: "swan-dickson", name: "Swan Asian Grocery", kind: "asian", where: "Badham St, Dickson", lat: -35.2507, lon: 149.1376 },
  { id: "deji-dickson", name: "Deji Asian Supermarket", kind: "asian", where: "Dickson", lat: -35.2506, lon: 149.1364 },
  { id: "abuy-dickson", name: "Abuy Asian Grocery", kind: "asian", where: "Dickson", lat: -35.2504, lon: 149.1368 },
  { id: "spar-civic", name: "Spar", kind: "convenience", where: "Civic", lat: -35.2788, lon: 149.1257 },
  { id: "supa24-civic", name: "Supa 24", kind: "convenience", where: "Civic", lat: -35.2784, lon: 149.1308 },
  { id: "ezymart-civic", name: "EzyMart", kind: "convenience", where: "Civic", lat: -35.2777, lon: 149.129 },
  { id: "capital-mart-civic", name: "21 Capital Mart", kind: "convenience", where: "Civic", lat: -35.2842, lon: 149.1246 },
  { id: "buddys-civic-north", name: "Buddy's Convenience", kind: "convenience", where: "Civic (north)", lat: -35.2773, lon: 149.1298 },
  { id: "buddys-civic-south", name: "Buddy's Convenience", kind: "convenience", where: "Civic (south)", lat: -35.2801, lon: 149.1311 },
  { id: "all-in-one-civic", name: "All In One", kind: "convenience", where: "Civic", lat: -35.2782, lon: 149.1286 },
  { id: "all-in-one-dickson", name: "All In One Super Mart", kind: "convenience", where: "Dickson", lat: -35.2507, lon: 149.1352 },
];

export const storeById = new Map(STORES.map((s) => [s.id, s]));
