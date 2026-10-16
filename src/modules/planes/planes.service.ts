import { Inject, Injectable, Logger } from "@nestjs/common"
import * as turf from "@turf/turf"
import { Cacheable } from "cacheable"
import ms from "ms"
import {
  AdsbAircraft,
  AdsbAirport,
  AdsbApiClient,
  AdsbFlightRoute,
} from "./adsb-client"
import { altitudeColor } from "./altitude-color"
import { detectRunway, RunwayDatabase, RunwayMatch } from "./runways"

export const ADSB_API_CLIENT = Symbol("ADSB_API_CLIENT")
export const PLANES_CONFIG = Symbol("PLANES_CONFIG")
export const RUNWAY_DATABASE = Symbol("RUNWAY_DATABASE")

export interface PlanesConfig {
  defaultMaxAltitude: number
  defaultRadius: number
}

export interface ClosestPlaneQuery {
  lat: number
  lon: number
  maxAltitude?: number
  radius?: number
}

export interface Airport {
  iata: string
  icao: string
  name: string
  city: string
}

export interface Plane {
  hex: string
  callsign: string | null
  /** Hex colour for the callsign: red in an emergency, violet if interesting */
  callsignColor: string
  /** Emergency status, e.g. "general" for a 7700 squawk, otherwise null */
  emergency: string | null
  /** Military, flagged as interesting, an air ambulance or a helicopter */
  interesting: boolean
  registration: string | null
  type: string | null
  /** Feet, never below 0 */
  altitude: number
  /** Hex colour for the altitude, e.g. "FF8E1E" */
  altitudeColor: string
  /** Feet per minute, negative when descending */
  verticalRate: number | null
  /** Knots */
  groundSpeed: number | null
  /** Degrees the plane is heading */
  track: number | null
  /** Nautical miles from the requested point */
  distance: number
  /** Degrees from the requested point to the plane */
  bearing: number
  /** Eight-point compass direction of `bearing`, e.g. "NE" */
  compass: string
  airline: { name: string; iata: string | null; icao: string } | null
  origin: Airport | null
  destination: Airport | null
  /** The runway it's landing on or has just taken off from, if any */
  runway: RunwayMatch | null
}

// Positions older than this are probably planes that have left coverage
const MAX_POSITION_AGE_SECONDS = 60

// Covers the longest approach detectRunway accepts, plus the runway itself
const RUNWAY_SEARCH_NM = 15

const COMPASS_POINTS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"]

export function toCompass(bearing: number): string {
  return COMPASS_POINTS[Math.round(bearing / 45) % 8]
}

const CALLSIGN_COLOR = "5096FF"
const EMERGENCY_COLOR = "FF2020"
const INTERESTING_COLOR = "BE82FF"

const EMERGENCY_SQUAWKS: Record<string, string> = {
  "7500": "unlawful",
  "7600": "nordo",
  "7700": "general",
}

// "lifeguard" is a medical flight's priority status rather than an emergency
const EMERGENCY_STATUSES = ["general", "minfuel", "nordo", "unlawful", "downed"]

const MILITARY_FLAG = 1
const INTERESTING_FLAG = 2

export function getEmergency(ac: AdsbAircraft): string | null {
  if (ac.emergency && EMERGENCY_STATUSES.includes(ac.emergency)) {
    return ac.emergency
  }
  return (ac.squawk && EMERGENCY_SQUAWKS[ac.squawk]) || null
}

export function isInteresting(ac: AdsbAircraft): boolean {
  const flags = ac.dbFlags ?? 0
  return (
    (flags & (MILITARY_FLAG | INTERESTING_FLAG)) !== 0 ||
    ac.emergency === "lifeguard" ||
    ac.category === "A7"
  )
}

@Injectable()
export class PlanesService {
  private readonly logger = new Logger(PlanesService.name)

  constructor(
    @Inject(ADSB_API_CLIENT) private readonly apiClient: AdsbApiClient,
    @Inject(PLANES_CONFIG) private readonly config: PlanesConfig,
    private readonly cache: Cacheable,
    @Inject(RUNWAY_DATABASE) private readonly runways: RunwayDatabase | null,
  ) {}

  async getClosestPlane(query: ClosestPlaneQuery): Promise<Plane | null> {
    const maxAltitude = query.maxAltitude ?? this.config.defaultMaxAltitude
    const radius = query.radius ?? this.config.defaultRadius
    const here = turf.point([query.lon, query.lat])

    const closest = (await this.getAircraft(query.lat, query.lon, radius))
      .filter(
        (
          ac,
        ): ac is AdsbAircraft & {
          alt_baro: number
          lat: number
          lon: number
        } =>
          typeof ac.alt_baro === "number" &&
          ac.alt_baro <= maxAltitude &&
          ac.lat !== undefined &&
          ac.lon !== undefined &&
          (ac.seen_pos ?? 0) <= MAX_POSITION_AGE_SECONDS,
      )
      .map((ac) => {
        const there = turf.point([ac.lon, ac.lat])
        return {
          ac,
          distance: turf.distance(here, there, { units: "nauticalmiles" }),
          bearing: (turf.bearing(here, there) + 360) % 360,
        }
      })
      .filter(({ distance }) => distance <= radius)
      .sort((a, b) => a.distance - b.distance)[0]

    if (!closest) {
      return null
    }

    const { ac, distance, bearing } = closest
    const callsign = ac.flight?.trim() || null
    const route = callsign ? await this.getRoute(callsign) : null
    const emergency = getEmergency(ac)
    const interesting = isInteresting(ac)
    // Barometric altitude can dip below 0 near the runway
    const altitude = Math.max(0, ac.alt_baro)
    const verticalRate = ac.baro_rate ?? ac.geom_rate ?? null
    const track = ac.track ?? null
    const runway = this.runways
      ? detectRunway(
          { lat: ac.lat, lon: ac.lon, track, altitude, verticalRate },
          await this.runways.getEndsNear(ac.lat, ac.lon, RUNWAY_SEARCH_NM),
        )
      : null

    return {
      hex: ac.hex,
      callsign,
      callsignColor: emergency
        ? EMERGENCY_COLOR
        : interesting
          ? INTERESTING_COLOR
          : CALLSIGN_COLOR,
      emergency,
      interesting,
      registration: ac.r ?? null,
      type: ac.t ?? null,
      altitude,
      altitudeColor: altitudeColor(altitude),
      verticalRate,
      groundSpeed: ac.gs !== undefined ? Math.round(ac.gs) : null,
      track: track !== null ? Math.round(track) : null,
      distance: Math.round(distance * 10) / 10,
      bearing: Math.round(bearing) % 360,
      compass: toCompass(bearing),
      airline: route?.airline
        ? {
            name: route.airline.name,
            iata: route.airline.iata ?? null,
            icao: route.airline.icao,
          }
        : null,
      origin: route ? toAirport(route.origin) : null,
      destination: route ? toAirport(route.destination) : null,
      runway,
    }
  }

  private async getAircraft(
    lat: number,
    lon: number,
    radius: number,
  ): Promise<AdsbAircraft[]> {
    // Rounding to ~100 m lets boards near each other share one request
    const key = `planes:aircraft:${lat.toFixed(3)}:${lon.toFixed(3)}:${radius}`
    const cached = await this.cache.get<AdsbAircraft[]>(key)
    if (cached) {
      return cached
    }

    const aircraft = await this.apiClient.getAircraftNear(
      Number(lat.toFixed(3)),
      Number(lon.toFixed(3)),
      radius,
    )
    await this.cache.set(key, aircraft, ms("5s"))
    return aircraft
  }

  private async getRoute(callsign: string): Promise<AdsbFlightRoute | null> {
    const key = `planes:route:${callsign}`
    // Wrapped so that a known miss is cached too
    const cached = await this.cache.get<{ route: AdsbFlightRoute | null }>(key)
    if (cached) {
      return cached.route
    }

    try {
      const route = await this.apiClient.getRoute(callsign)
      await this.cache.set(key, { route }, route ? ms("12h") : ms("1h"))
      return route
    } catch (err) {
      // A missing route shouldn't hide the plane
      this.logger.warn(`Route lookup failed for ${callsign}: ${err}`)
      return null
    }
  }
}

function toAirport(airport: AdsbAirport): Airport {
  return {
    iata: airport.iata_code,
    icao: airport.icao_code,
    name: airport.name,
    city: airport.municipality,
  }
}
