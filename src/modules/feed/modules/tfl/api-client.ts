import { DomainError } from "../../../../errors/domain-error"
import { StopNotFoundError } from "../../feed.errors"

export interface TflPrediction {
  id: string
  vehicleId?: string
  naptanId: string
  stationName: string
  lineId: string
  lineName: string
  platformName?: string
  direction?: string
  destinationNaptanId?: string
  destinationName?: string
  towards?: string
  timeToStation: number
  timestamp: string
  expectedArrival: string
  modeName: string
}

export interface TflStopPoint {
  naptanId: string
  commonName: string
  stopType: string
  modes: string[]
  lat: number
  lon: number
  lines?: { id: string; name: string }[]
  children?: TflStopPoint[]
}

export interface TflStopPointsResponse {
  stopPoints: TflStopPoint[]
}

export interface TflRouteSection {
  naptanId: string
  lineId: string
  mode: string
  direction: string
  destinationName: string
  isActive: boolean
}

export class TflApiError extends Error {
  constructor(message: string) {
    super(message)
    this.name = new.target.name
  }
}

export class TflApiClient {
  constructor(
    readonly baseUrl: string,
    private readonly appKey?: string,
  ) {}

  /**
   * Note: TfL returns the whole station hierarchy here, so asking for a
   * station inside an interchange (e.g. 940GZZLUKSX) returns its hub
   * (HUBKGX) with the requested station somewhere in `children`.
   */
  async getStopPoint(naptanId: string): Promise<TflStopPoint> {
    return this.fetchJson(
      `/StopPoint/${encodeURIComponent(naptanId)}`,
      {},
      () => new StopNotFoundError(naptanId),
    )
  }

  async getStopPointsByRadius(
    lat: number,
    lon: number,
    radius: number,
    stopTypes: string[],
    modes: string[],
  ): Promise<TflStopPoint[]> {
    const response = await this.fetchJson<TflStopPointsResponse>("/StopPoint", {
      lat: lat.toString(),
      lon: lon.toString(),
      radius: radius.toString(),
      stopTypes: stopTypes.join(","),
      modes: modes.join(","),
      returnLines: "true",
    })
    return response.stopPoints
  }

  async getArrivals(naptanId: string): Promise<TflPrediction[]> {
    return this.fetchJson(
      `/StopPoint/${encodeURIComponent(naptanId)}/Arrivals`,
      {},
      () => new StopNotFoundError(naptanId),
    )
  }

  async getRouteSections(naptanId: string): Promise<TflRouteSection[]> {
    return this.fetchJson(
      `/StopPoint/${encodeURIComponent(naptanId)}/Route`,
      {},
      () => new StopNotFoundError(naptanId),
    )
  }

  private async fetchJson<T>(
    path: string,
    params: Record<string, string>,
    notFound?: () => DomainError,
  ): Promise<T> {
    const url = new URL(`${this.baseUrl}${path}`)
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value)
    }
    if (this.appKey) {
      url.searchParams.set("app_key", this.appKey)
    }

    const response = await fetch(url)
    if (!response.ok) {
      if (response.status === 404 && notFound) {
        throw notFound()
      }
      throw new TflApiError(
        `TfL API request failed: ${response.status} ${response.statusText}`,
      )
    }
    return response.json() as Promise<T>
  }
}
