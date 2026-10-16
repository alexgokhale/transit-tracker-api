export interface AdsbAircraft {
  hex: string
  flight?: string
  /** Registration */
  r?: string
  /** ICAO aircraft type, e.g. B78X */
  t?: string
  /** Barometric altitude in feet, or "ground" */
  alt_baro?: number | "ground"
  /** Ground speed in knots */
  gs?: number
  track?: number
  /** Vertical rate in feet per minute */
  baro_rate?: number
  geom_rate?: number
  lat?: number
  lon?: number
  /** Seconds since the position was last updated */
  seen_pos?: number
  squawk?: string
  /** none, general, lifeguard, minfuel, nordo, unlawful, downed or reserved */
  emergency?: string
  /** Emitter category, e.g. A3 for a large jet or A7 for a helicopter */
  category?: string
  /** Bit 1: military, bit 2: interesting (from the tar1090 database) */
  dbFlags?: number
}

interface AdsbPointResponse {
  ac?: AdsbAircraft[]
}

export interface AdsbAirport {
  name: string
  iata_code: string
  icao_code: string
  municipality: string
}

export interface AdsbFlightRoute {
  callsign: string
  callsign_iata?: string
  airline?: { name: string; iata?: string; icao: string }
  origin: AdsbAirport
  destination: AdsbAirport
}

interface AdsbdbCallsignResponse {
  response: { flightroute?: AdsbFlightRoute } | string
}

export class AdsbApiError extends Error {
  constructor(message: string) {
    super(message)
    this.name = new.target.name
  }
}

/**
 * Talks to an ADS-B Exchange v2 style API (adsb.lol, airplanes.live) for
 * live aircraft, and to adsbdb for callsign routes.
 */
export class AdsbApiClient {
  constructor(
    readonly aircraftBaseUrl: string,
    readonly routesBaseUrl: string,
  ) {}

  async getAircraftNear(
    lat: number,
    lon: number,
    radiusNm: number,
  ): Promise<AdsbAircraft[]> {
    const response = await this.fetchJson<AdsbPointResponse>(
      `${this.aircraftBaseUrl}/v2/point/${lat}/${lon}/${radiusNm}`,
    )
    return response?.ac ?? []
  }

  /**
   * Routes come from crowd-sourced data, so they can be missing or wrong.
   */
  async getRoute(callsign: string): Promise<AdsbFlightRoute | null> {
    const response = await this.fetchJson<AdsbdbCallsignResponse>(
      `${this.routesBaseUrl}/v0/callsign/${encodeURIComponent(callsign)}`,
    )
    if (!response || typeof response.response === "string") {
      return null
    }
    return response.response.flightroute ?? null
  }

  private async fetchJson<T>(url: string): Promise<T | null> {
    const response = await fetch(url, {
      headers: {
        "User-Agent":
          "Transit Tracker API (https://transit-tracker.eastsideurbanism.org/)",
      },
    })
    if (response.status === 404) {
      return null
    }
    if (!response.ok) {
      throw new AdsbApiError(
        `ADS-B API request failed: ${response.status} ${response.statusText}`,
      )
    }
    return response.json() as Promise<T>
  }
}
