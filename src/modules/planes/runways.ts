import { Logger } from "@nestjs/common"
import * as turf from "@turf/turf"
import { parseString } from "fast-csv"
import ms from "ms"

export interface RunwayEnd {
  /** Airport identifier, usually the ICAO code, e.g. EGLL */
  airport: string
  /** Runway designator for this end, e.g. 27R */
  ident: string
  lat: number
  lon: number
  /** True heading when landing on or taking off from this end */
  heading: number
  /** Field elevation in feet, if known */
  elevation: number | null
  /** Runway length in nautical miles */
  length: number
}

export interface RunwayMatch {
  airport: string
  runway: string
  phase: "arriving" | "departing"
}

export interface RunwayAircraft {
  lat: number
  lon: number
  /** Degrees */
  track: number | null
  /** Feet */
  altitude: number
  /** Feet per minute */
  verticalRate: number | null
}

interface RunwayRow {
  airport_ident: string
  closed: string
  le_ident: string
  le_latitude_deg: string
  le_longitude_deg: string
  le_elevation_ft: string
  he_ident: string
  he_latitude_deg: string
  he_longitude_deg: string
  he_elevation_ft: string
}

// Generous limits: the closest centre line wins, so these only need to rule
// out planes that clearly aren't on an approach or departure
const MAX_TRACK_DIFFERENCE = 20
const MAX_CROSS_TRACK_NM = 1
const MAX_APPROACH_NM = 12
const MAX_CLIMB_OUT_NM = 8
const MAX_HEIGHT_FT = 5000
const MIN_VERTICAL_RATE = 200

function toNumber(value: string): number | null {
  if (value.trim() === "") return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

/**
 * Turns OurAirports' runways.csv into one entry per usable runway end.
 * Closed runways and runways without both end positions (mostly helipads)
 * are skipped.
 */
export async function parseRunways(csv: string): Promise<RunwayEnd[]> {
  const rows: RunwayRow[] = await new Promise((resolve, reject) => {
    const parsed: RunwayRow[] = []
    parseString<RunwayRow, RunwayRow>(csv, { headers: true })
      .on("data", (row: RunwayRow) => parsed.push(row))
      .on("error", reject)
      .on("end", () => resolve(parsed))
  })

  const ends: RunwayEnd[] = []
  for (const row of rows) {
    const leLat = toNumber(row.le_latitude_deg)
    const leLon = toNumber(row.le_longitude_deg)
    const heLat = toNumber(row.he_latitude_deg)
    const heLon = toNumber(row.he_longitude_deg)
    if (
      row.closed === "1" ||
      !row.le_ident ||
      !row.he_ident ||
      leLat === null ||
      leLon === null ||
      heLat === null ||
      heLon === null
    ) {
      continue
    }

    // Worked out from the end positions, since the published headings are
    // often missing or magnetic
    const le = turf.point([leLon, leLat])
    const he = turf.point([heLon, heLat])
    const heading = (turf.bearing(le, he) + 360) % 360
    const length = turf.distance(le, he, { units: "nauticalmiles" })

    ends.push(
      {
        airport: row.airport_ident,
        ident: row.le_ident,
        lat: leLat,
        lon: leLon,
        heading,
        elevation: toNumber(row.le_elevation_ft),
        length,
      },
      {
        airport: row.airport_ident,
        ident: row.he_ident,
        lat: heLat,
        lon: heLon,
        heading: (heading + 180) % 360,
        elevation: toNumber(row.he_elevation_ft),
        length,
      },
    )
  }
  return ends
}

function angleDifference(a: number, b: number): number {
  const diff = Math.abs(a - b) % 360
  return diff > 180 ? 360 - diff : diff
}

/**
 * Works out whether a plane is landing on or has just taken off from one of
 * the given runway ends.
 *
 * A plane lines up with the runway's centre line in both cases. Arriving
 * planes are descending and before the far end of the runway; departing
 * planes are climbing and past the start of it. When several runways fit
 * (e.g. parallel runways), the one whose centre line is closest wins.
 */
export function detectRunway(
  aircraft: RunwayAircraft,
  ends: RunwayEnd[],
): RunwayMatch | null {
  const { track, verticalRate } = aircraft
  if (track === null || verticalRate === null) {
    return null
  }

  const descending = verticalRate <= MIN_VERTICAL_RATE
  const climbing = verticalRate >= MIN_VERTICAL_RATE
  let best: { match: RunwayMatch; crossTrack: number } | null = null

  for (const end of ends) {
    if (angleDifference(track, end.heading) > MAX_TRACK_DIFFERENCE) continue
    if (aircraft.altitude - (end.elevation ?? 0) > MAX_HEIGHT_FT) continue

    // Flat projection around the threshold, in nautical miles
    const x =
      (aircraft.lon - end.lon) * 60 * Math.cos((end.lat * Math.PI) / 180)
    const y = (aircraft.lat - end.lat) * 60
    const headingRad = (end.heading * Math.PI) / 180
    const along = x * Math.sin(headingRad) + y * Math.cos(headingRad)
    const crossTrack = Math.abs(
      x * Math.cos(headingRad) - y * Math.sin(headingRad),
    )
    if (crossTrack > MAX_CROSS_TRACK_NM) continue

    let phase: RunwayMatch["phase"] | null = null
    if (descending && along >= -MAX_APPROACH_NM && along <= end.length) {
      phase = "arriving"
    } else if (
      climbing &&
      along >= 0 &&
      along <= end.length + MAX_CLIMB_OUT_NM
    ) {
      phase = "departing"
    }

    if (phase && (!best || crossTrack < best.crossTrack)) {
      best = {
        match: { airport: end.airport, runway: end.ident, phase },
        crossTrack,
      }
    }
  }

  return best?.match ?? null
}

/**
 * Downloads OurAirports' runway list once a day and keeps it in memory.
 */
export class RunwayDatabase {
  private readonly logger = new Logger(RunwayDatabase.name)
  private ends: RunwayEnd[] = []
  private loadedAt = 0
  private retryAt = 0
  private loading?: Promise<void>

  constructor(private readonly url: string) {}

  async getEndsNear(
    lat: number,
    lon: number,
    radiusNm: number,
  ): Promise<RunwayEnd[]> {
    await this.refreshIfStale()

    // Cheap latitude check first; a degree of latitude is 60 nm
    const here = turf.point([lon, lat])
    return this.ends.filter(
      (end) =>
        Math.abs(end.lat - lat) * 60 <= radiusNm &&
        turf.distance(here, turf.point([end.lon, end.lat]), {
          units: "nauticalmiles",
        }) <= radiusNm,
    )
  }

  private async refreshIfStale(): Promise<void> {
    const now = Date.now()
    if (now - this.loadedAt < ms("24h") || now < this.retryAt) {
      return
    }

    this.loading ??= this.load().finally(() => {
      this.loading = undefined
    })
    await this.loading
  }

  private async load(): Promise<void> {
    try {
      const response = await fetch(this.url)
      if (!response.ok) {
        throw new Error(`${response.status} ${response.statusText}`)
      }
      this.ends = await parseRunways(await response.text())
      this.loadedAt = Date.now()
      this.logger.log(`Loaded ${this.ends.length} runway ends`)
    } catch (err) {
      // Runways are a nice extra, so keep going without them for a while
      this.retryAt = Date.now() + ms("1h")
      this.logger.warn(`Failed to load runways: ${err}`)
    }
  }
}
