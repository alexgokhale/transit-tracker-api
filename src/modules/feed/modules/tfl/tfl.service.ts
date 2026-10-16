import { Inject } from "@nestjs/common"
import { BBox } from "geojson"
import ms from "ms"
import { PinoLogger } from "nestjs-pino"
import { DateTimeService } from "src/modules/datetime/datetime.service"
import type {
  FeedContext,
  FeedProvider,
  RouteAtStop,
  Stop,
  StopRoute,
  TripStop,
} from "src/modules/feed/interfaces/feed-provider.interface"
import { DeepReadonly } from "ts-essentials"
import { RegisterFeedProvider } from "../../decorators/feed-provider.decorator"
import { FEED_CONTEXT } from "../../feed-context"
import { StopNotFoundError } from "../../feed.errors"
import { FeedCacheService } from "../feed-cache/feed-cache.service"
import {
  TflApiClient,
  TflPrediction,
  TflRouteSection,
  TflStopPoint,
} from "./api-client"
import { branchVia } from "./branches"
import { TflConfig, TflConfigSchema } from "./config"
import { TFL_LINES } from "./lines"

const STATION_STOP_TYPES = ["NaptanMetroStation", "NaptanRailStation"]
const DIRECTIONS = ["inbound", "outbound"]
const MAX_SEARCH_RADIUS_METRES = 2000

// Covers the furthest TfL rail stations (Reading, Chesham, Shenfield)
const TFL_NETWORK_BOUNDS: BBox = [-1.0, 51.25, 0.4, 51.75]

/**
 * Route IDs are `<lineId>:<direction>` (e.g. `piccadilly:inbound`) so a
 * display can follow one direction of a line at a station.
 */
export function toRouteId(lineId: string, direction: string): string {
  return `${lineId}:${direction}`
}

/**
 * Strips the suffixes TfL puts on station names, e.g.
 * "Hammersmith (H&C Line) Underground Station" -> "Hammersmith" and
 * "New Cross ELL" (East London Line) -> "New Cross".
 */
export function cleanStationName(name: string): string {
  return name
    .replace(/\s+(Underground|DLR|Rail|Tram) Station$/i, "")
    .replace(/\s+\([^)]*\)/g, "")
    .replace(/\s+ELL$/, "")
    .trim()
}

@RegisterFeedProvider("tfl")
export class TflService implements FeedProvider {
  private readonly modes: string[]
  private readonly shortLineNames: boolean
  private readonly latestArrivals = new Map<
    string,
    { timestamp: number; arrivals: TflPrediction[] }
  >()

  constructor(
    @Inject(FEED_CONTEXT) { feedCode, config }: FeedContext<TflConfig>,
    private readonly cache: FeedCacheService,
    private readonly apiClient: TflApiClient,
    private readonly dateTime: DateTimeService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(`${TflService.name}[${feedCode}]`)
    this.modes = config.modes
    this.shortLineNames = config.shortLineNames
  }

  static validateConfig(config: unknown): TflConfig {
    return TflConfigSchema.parse(config)
  }

  async healthCheck(): Promise<void> {
    // Oxford Circus Underground Station
    await this.apiClient.getStopPoint("940GZZLUOXC")
  }

  async getAgencyBounds(): Promise<BBox> {
    return TFL_NETWORK_BOUNDS
  }

  async getStop(stopId: string): Promise<Stop> {
    return this.cache.cached(
      `stop-${stopId}`,
      async () => {
        const root = await this.apiClient.getStopPoint(stopId)
        const stopPoint = this.findStopPoint(root, stopId)
        if (!stopPoint) {
          throw new StopNotFoundError(stopId)
        }

        return this.toStop(stopPoint)
      },
      ms("24h"),
    )
  }

  async getRoutesForStop(
    stopId: string,
  ): Promise<ReadonlyArray<DeepReadonly<StopRoute>>> {
    const sections = await this.getRouteSections(stopId)

    const routeMap = new Map<string, StopRoute & { headsigns: string[] }>()
    for (const section of sections) {
      const routeId = toRouteId(section.lineId, section.direction)
      const headsign = cleanStationName(section.destinationName)

      const route = routeMap.get(routeId)
      if (!route) {
        routeMap.set(routeId, {
          routeId,
          name: this.lineName(section.lineId),
          color: TFL_LINES[section.lineId]?.color ?? null,
          headsigns: [headsign],
        })
      } else if (!route.headsigns.includes(headsign)) {
        route.headsigns.push(headsign)
      }
    }

    return Array.from(routeMap.values())
  }

  async getStopsInArea(bbox: BBox): Promise<Stop[]> {
    const [minLon, minLat, maxLon, maxLat] = bbox
    const centerLat = (minLat + maxLat) / 2
    const centerLon = (minLon + maxLon) / 2

    // Distance from the centre to a corner, so the circle covers the box
    const latMetres = ((maxLat - minLat) / 2) * 111_320
    const lonMetres =
      ((maxLon - minLon) / 2) * 111_320 * Math.cos((centerLat * Math.PI) / 180)
    const radius = Math.min(
      Math.ceil(Math.hypot(latMetres, lonMetres)),
      MAX_SEARCH_RADIUS_METRES,
    )

    const stopPoints = await this.apiClient.getStopPointsByRadius(
      centerLat,
      centerLon,
      radius,
      STATION_STOP_TYPES,
      this.modes,
    )

    return stopPoints
      .filter(
        (stopPoint) =>
          stopPoint.lon >= minLon &&
          stopPoint.lon <= maxLon &&
          stopPoint.lat >= minLat &&
          stopPoint.lat <= maxLat,
      )
      .map((stopPoint) => this.toStop(stopPoint))
  }

  async getUpcomingTripsForRoutesAtStops(
    routes: RouteAtStop[],
  ): Promise<TripStop[]> {
    const routeIdsByStop = new Map<string, string[]>()
    for (const { routeId, stopId } of routes) {
      routeIdsByStop.set(stopId, [
        ...(routeIdsByStop.get(stopId) ?? []),
        routeId,
      ])
    }

    const tripStops: TripStop[] = []

    for (const [stopId, routeIds] of routeIdsByStop) {
      const arrivals = await this.getArrivals(stopId)
      if (arrivals.length === 0) {
        continue
      }

      const [stop, sections] = await Promise.all([
        this.getStop(stopId),
        this.getRouteSections(stopId),
      ])
      const directions = this.resolveDirections(arrivals, sections)
      const now = this.dateTime.now().getTime()

      for (const arrival of arrivals) {
        if (arrival.destinationNaptanId === stopId) {
          // Skip trains that terminate here
          continue
        }

        const direction = directions.get(arrival)
        if (!direction) {
          continue
        }

        const routeId = toRouteId(arrival.lineId, direction)
        if (!routeIds.includes(routeId)) {
          continue
        }

        const arrivalTime = new Date(arrival.expectedArrival)
        if (arrivalTime.getTime() < now) {
          continue
        }

        const tripId = `${arrival.lineId}-${arrival.vehicleId || arrival.id}`
        if (tripStops.some((t) => t.tripId === tripId && t.stopId === stopId)) {
          continue
        }

        tripStops.push({
          tripId,
          stopId,
          routeId,
          routeName: this.boardLineName(arrival.lineId, arrival.lineName),
          routeColor: TFL_LINES[arrival.lineId]?.color ?? null,
          stopName: stop.name,
          headsign: this.headsign(arrival),
          directionId: direction,
          arrivalTime,
          departureTime: arrivalTime,
          vehicle: arrival.vehicleId || null,
          isRealtime: true,
        })
      }
    }

    return tripStops
  }

  private async getArrivals(
    stopId: string,
  ): Promise<DeepReadonly<TflPrediction[]>> {
    return this.cache.cached(`arrivals-${stopId}`, async () => {
      let arrivals = (await this.apiClient.getArrivals(stopId)).filter((a) =>
        this.modes.includes(a.modeName),
      )

      // TfL's load balancer sometimes serves data older than the previous
      // response, so keep the previous one when that happens
      const timestamp = Math.max(
        0,
        ...arrivals.map((a) => new Date(a.timestamp).getTime()),
      )
      const previous = this.latestArrivals.get(stopId)
      if (previous && arrivals.length > 0 && timestamp < previous.timestamp) {
        this.logger.debug({ stopId }, "Ignoring stale TfL arrivals")
        arrivals = previous.arrivals
      } else {
        this.latestArrivals.set(stopId, { timestamp, arrivals })
      }

      // TfL refreshes predictions roughly every 30 seconds
      return {
        value: arrivals,
        ttl: arrivals.length > 0 ? ms("30s") : ms("2m"),
      }
    })
  }

  private async getRouteSections(
    stopId: string,
  ): Promise<DeepReadonly<TflRouteSection[]>> {
    return this.cache.cached(
      `routeSections-${stopId}`,
      async () => {
        const sections = await this.apiClient.getRouteSections(stopId)
        return sections.filter(
          (section) =>
            section.isActive &&
            this.modes.includes(section.mode) &&
            DIRECTIONS.includes(section.direction),
        )
      },
      ms("24h"),
    )
  }

  /**
   * Works out whether each arrival is inbound or outbound. Tube predictions
   * often leave `direction` empty, so fall back to matching the destination
   * against the station's route sections, then to other trains on the same
   * platform. Arrivals that still can't be placed are left out.
   */
  private resolveDirections(
    arrivals: DeepReadonly<TflPrediction[]>,
    sections: DeepReadonly<TflRouteSection[]>,
  ): Map<DeepReadonly<TflPrediction>, string> {
    const directions = new Map<DeepReadonly<TflPrediction>, string>()
    const platformDirections = new Map<string, string>()
    const platformKey = (a: DeepReadonly<TflPrediction>) =>
      `${a.lineId}|${a.platformName}`

    for (const arrival of arrivals) {
      const direction =
        this.directionFromField(arrival) ??
        this.directionFromDestination(arrival, sections)
      if (direction) {
        directions.set(arrival, direction)
        if (arrival.platformName) {
          platformDirections.set(platformKey(arrival), direction)
        }
      }
    }

    for (const arrival of arrivals) {
      if (directions.has(arrival) || !arrival.platformName) {
        continue
      }

      const direction = platformDirections.get(platformKey(arrival))
      if (direction) {
        directions.set(arrival, direction)
      } else {
        this.logger.debug(
          { lineId: arrival.lineId, platformName: arrival.platformName },
          "Could not determine direction for arrival",
        )
      }
    }

    return directions
  }

  private directionFromField(
    arrival: DeepReadonly<TflPrediction>,
  ): string | null {
    return arrival.direction && DIRECTIONS.includes(arrival.direction)
      ? arrival.direction
      : null
  }

  private directionFromDestination(
    arrival: DeepReadonly<TflPrediction>,
    sections: DeepReadonly<TflRouteSection[]>,
  ): string | null {
    if (!arrival.destinationName) {
      return null
    }

    const destination = cleanStationName(arrival.destinationName)
    const matches = new Set(
      sections
        .filter(
          (section) =>
            section.lineId === arrival.lineId &&
            cleanStationName(section.destinationName) === destination,
        )
        .map((section) => section.direction),
    )

    return matches.size === 1 ? [...matches][0] : null
  }

  private headsign(arrival: DeepReadonly<TflPrediction>): string {
    if (arrival.destinationName) {
      // Keep the branch from `towards` where it matters, e.g. "Edgware via CX"
      const via = branchVia(
        arrival.lineId,
        arrival.naptanId,
        arrival.destinationNaptanId,
        arrival.towards,
      )
      return cleanStationName(arrival.destinationName) + via
    }

    if (arrival.towards && arrival.towards !== "Check Front of Train") {
      return arrival.towards
    }

    // e.g. "Westbound - Platform 5" -> "Westbound"
    return arrival.platformName?.split(" - ")[0] ?? arrival.lineName
  }

  private lineName(lineId: string, fallback?: string): string {
    return TFL_LINES[lineId]?.name ?? fallback ?? lineId
  }

  /** Line names on a board are short codes like "BKR" unless configured off */
  private boardLineName(lineId: string, fallback: string): string {
    if (this.shortLineNames && TFL_LINES[lineId]) {
      return TFL_LINES[lineId].shortName
    }
    return this.lineName(lineId, fallback)
  }

  private findStopPoint(
    stopPoint: TflStopPoint,
    naptanId: string,
  ): TflStopPoint | null {
    if (stopPoint.naptanId === naptanId) {
      return stopPoint
    }

    for (const child of stopPoint.children ?? []) {
      const found = this.findStopPoint(child, naptanId)
      if (found) {
        return found
      }
    }

    return null
  }

  private toStop(stopPoint: TflStopPoint): Stop {
    return {
      stopId: stopPoint.naptanId,
      stopCode: null,
      name: cleanStationName(stopPoint.commonName),
      lat: stopPoint.lat,
      lon: stopPoint.lon,
    }
  }
}
