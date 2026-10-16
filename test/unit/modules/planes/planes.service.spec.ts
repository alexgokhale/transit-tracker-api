import { Cacheable } from "cacheable"
import {
  AdsbAircraft,
  AdsbApiClient,
  AdsbFlightRoute,
} from "src/modules/planes/adsb-client"
import {
  getEmergency,
  isInteresting,
  PlanesService,
  toCompass,
} from "src/modules/planes/planes.service"
import { RunwayDatabase } from "src/modules/planes/runways"
import { mock, MockProxy } from "vitest-mock-extended"

const HEATHROW = { lat: 51.47, lon: -0.4543 }

// Place an aircraft a number of nautical miles north (or south) and east
// (or west) of HEATHROW
function makeAircraft(
  northNm: number,
  eastNm: number,
  overrides: Partial<AdsbAircraft> = {},
): AdsbAircraft {
  return {
    hex: "4ca1b2",
    flight: "BAW81V  ",
    r: "G-ZBLA",
    t: "B78X",
    alt_baro: 1800,
    gs: 154.4,
    track: 269.6,
    baro_rate: -800,
    lat: HEATHROW.lat + northNm / 60,
    lon:
      HEATHROW.lon + eastNm / (60 * Math.cos((HEATHROW.lat * Math.PI) / 180)),
    seen_pos: 1,
    ...overrides,
  }
}

const ROUTE: AdsbFlightRoute = {
  callsign: "BAW81V",
  callsign_iata: "BA81V",
  airline: { name: "British Airways", iata: "BA", icao: "BAW" },
  origin: {
    name: "George Bush Intercontinental Airport",
    iata_code: "IAH",
    icao_code: "KIAH",
    municipality: "Houston",
  },
  destination: {
    name: "London Heathrow Airport",
    iata_code: "LHR",
    icao_code: "EGLL",
    municipality: "London",
  },
}

describe("PlanesService", () => {
  let apiClient: MockProxy<AdsbApiClient>
  let runways: MockProxy<RunwayDatabase>
  let service: PlanesService

  beforeEach(() => {
    runways = mock<RunwayDatabase>()
    runways.getEndsNear.mockResolvedValue([])
    apiClient = mock<AdsbApiClient>()
    apiClient.getRoute.mockResolvedValue(ROUTE)
    service = new PlanesService(
      apiClient,
      { defaultMaxAltitude: 15000, defaultRadius: 10 },
      new Cacheable(),
      runways,
    )
  })

  it("returns the closest airborne plane with its route", async () => {
    apiClient.getAircraftNear.mockResolvedValue([
      makeAircraft(0, 4, { hex: "far", flight: "VIR450" }),
      makeAircraft(0, 2),
    ])

    const plane = await service.getClosestPlane(HEATHROW)

    expect(plane).toEqual({
      hex: "4ca1b2",
      callsign: "BAW81V",
      callsignColor: "5096FF",
      emergency: null,
      interesting: false,
      registration: "G-ZBLA",
      type: "B78X",
      altitude: 1800,
      altitudeColor: "FF931F",
      verticalRate: -800,
      groundSpeed: 154,
      track: 270,
      distance: 2,
      bearing: 90,
      compass: "E",
      airline: { name: "British Airways", iata: "BA", icao: "BAW" },
      origin: {
        iata: "IAH",
        icao: "KIAH",
        name: "George Bush Intercontinental Airport",
        city: "Houston",
      },
      destination: {
        iata: "LHR",
        icao: "EGLL",
        name: "London Heathrow Airport",
        city: "London",
      },
      runway: null,
    })
    expect(apiClient.getRoute).toHaveBeenCalledWith("BAW81V")
  })

  it("skips planes on the ground, too high, out of date or out of range", async () => {
    apiClient.getAircraftNear.mockResolvedValue([
      makeAircraft(0, 0.1, { hex: "ground", alt_baro: "ground" }),
      makeAircraft(0, 0.2, { hex: "high", alt_baro: 36000 }),
      makeAircraft(0, 0.3, { hex: "stale", seen_pos: 120 }),
      makeAircraft(0, 0.4, { hex: "nopos", lat: undefined, lon: undefined }),
      makeAircraft(11, 0, { hex: "outside" }),
      makeAircraft(-5, 0, { hex: "wanted" }),
    ])

    const plane = await service.getClosestPlane(HEATHROW)

    expect(plane?.hex).toBe("wanted")
    expect(plane?.compass).toBe("S")
  })

  it("returns null when no plane qualifies", async () => {
    apiClient.getAircraftNear.mockResolvedValue([
      makeAircraft(0, 1, { alt_baro: 20000 }),
    ])

    expect(await service.getClosestPlane(HEATHROW)).toBeNull()
  })

  it("lets the request override the altitude threshold and radius", async () => {
    apiClient.getAircraftNear.mockResolvedValue([
      makeAircraft(0, 1, { hex: "cruising", alt_baro: 36000 }),
    ])

    const plane = await service.getClosestPlane({
      ...HEATHROW,
      maxAltitude: 40000,
      radius: 25,
    })

    expect(plane?.hex).toBe("cruising")
    expect(apiClient.getAircraftNear).toHaveBeenCalledWith(51.47, -0.454, 25)
  })

  it("shares aircraft lookups between nearby requests", async () => {
    apiClient.getAircraftNear.mockResolvedValue([makeAircraft(0, 1)])

    await service.getClosestPlane(HEATHROW)
    await service.getClosestPlane({ lat: 51.47001, lon: -0.45431 })

    expect(apiClient.getAircraftNear).toHaveBeenCalledTimes(1)
  })

  it("still returns the plane when the route lookup fails", async () => {
    apiClient.getAircraftNear.mockResolvedValue([makeAircraft(0, 1)])
    apiClient.getRoute.mockRejectedValue(new Error("boom"))

    const plane = await service.getClosestPlane(HEATHROW)

    expect(plane?.callsign).toBe("BAW81V")
    expect(plane?.airline).toBeNull()
    expect(plane?.origin).toBeNull()
  })

  it("remembers callsigns with no known route", async () => {
    apiClient.getAircraftNear.mockResolvedValue([
      makeAircraft(0, 1, { flight: "N123AB" }),
    ])
    apiClient.getRoute.mockResolvedValue(null)

    await service.getClosestPlane(HEATHROW)
    await service.getClosestPlane({ ...HEATHROW, radius: 20 })

    expect(apiClient.getRoute).toHaveBeenCalledTimes(1)
  })

  it("does not look up a route for a plane with no callsign", async () => {
    apiClient.getAircraftNear.mockResolvedValue([
      makeAircraft(0, 1, { flight: undefined }),
    ])

    const plane = await service.getClosestPlane(HEATHROW)

    expect(plane?.callsign).toBeNull()
    expect(plane?.registration).toBe("G-ZBLA")
    expect(apiClient.getRoute).not.toHaveBeenCalled()
  })

  it("shows altitudes below sea level as 0", async () => {
    apiClient.getAircraftNear.mockResolvedValue([
      makeAircraft(0, 1, { alt_baro: -25 }),
    ])

    const plane = await service.getClosestPlane(HEATHROW)

    expect(plane?.altitude).toBe(0)
    expect(plane?.altitudeColor).toBe("FF691F")
  })

  it("adds the runway when the plane is landing", async () => {
    apiClient.getAircraftNear.mockResolvedValue([makeAircraft(0, 2)])
    runways.getEndsNear.mockResolvedValue([
      {
        airport: "EGLL",
        ident: "27R",
        lat: HEATHROW.lat,
        lon: HEATHROW.lon,
        heading: 270,
        elevation: 78,
        length: 2.1,
      },
    ])

    const plane = await service.getClosestPlane(HEATHROW)

    expect(plane?.runway).toEqual({
      airport: "EGLL",
      runway: "27R",
      phase: "arriving",
    })
  })

  it("colours the callsign red in an emergency", async () => {
    apiClient.getAircraftNear.mockResolvedValue([
      makeAircraft(0, 1, { squawk: "7700", dbFlags: 1 }),
    ])

    const plane = await service.getClosestPlane(HEATHROW)

    expect(plane?.emergency).toBe("general")
    expect(plane?.callsignColor).toBe("FF2020")
  })

  it("colours the callsign violet for interesting aircraft", async () => {
    apiClient.getAircraftNear.mockResolvedValue([
      makeAircraft(0, 1, { category: "A7" }),
    ])

    const plane = await service.getClosestPlane(HEATHROW)

    expect(plane?.interesting).toBe(true)
    expect(plane?.callsignColor).toBe("BE82FF")
  })
})

describe("getEmergency", () => {
  it.each([
    [{ squawk: "7500" }, "unlawful"],
    [{ squawk: "7600" }, "nordo"],
    [{ squawk: "7700" }, "general"],
    [{ emergency: "minfuel", squawk: "1234" }, "minfuel"],
    [{ emergency: "lifeguard" }, null],
    [{ emergency: "none", squawk: "7000" }, null],
  ])("reads %o as %s", (fields, expected) => {
    expect(getEmergency({ hex: "abc", ...fields })).toBe(expected)
  })
})

describe("isInteresting", () => {
  it.each([
    [{ dbFlags: 1 }, true],
    [{ dbFlags: 2 }, true],
    [{ dbFlags: 8 }, false],
    [{ emergency: "lifeguard" }, true],
    [{ category: "A7" }, true],
    [{ category: "A3" }, false],
  ])("reads %o as %s", (fields, expected) => {
    expect(isInteresting({ hex: "abc", ...fields })).toBe(expected)
  })
})

describe("toCompass", () => {
  it.each([
    [0, "N"],
    [22, "N"],
    [23, "NE"],
    [180, "S"],
    [337, "NW"],
    [359, "N"],
  ])("maps %d degrees to %s", (bearing, expected) => {
    expect(toCompass(bearing)).toBe(expected)
  })
})
