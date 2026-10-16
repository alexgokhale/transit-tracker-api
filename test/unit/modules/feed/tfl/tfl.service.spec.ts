import ms from "ms"
import { PinoLogger } from "nestjs-pino"
import { DateTimeService } from "src/modules/datetime/datetime.service"
import { StopNotFoundError } from "src/modules/feed/feed.errors"
import {
  FeedContext,
  RouteAtStop,
} from "src/modules/feed/interfaces/feed-provider.interface"
import { FeedCacheService } from "src/modules/feed/modules/feed-cache/feed-cache.service"
import {
  TflApiClient,
  TflPrediction,
  TflRouteSection,
  TflStopPoint,
} from "src/modules/feed/modules/tfl/api-client"
import { TflConfig } from "src/modules/feed/modules/tfl/config"
import {
  cleanStationName,
  TflService,
} from "src/modules/feed/modules/tfl/tfl.service"
import { mock, MockProxy } from "vitest-mock-extended"

const feedContext: FeedContext<TflConfig> = {
  feedCode: "test-feed",
  config: {
    baseUrl: "https://tfl.example.com",
    modes: ["tube"],
    shortLineNames: true,
  },
}

const NOW = new Date("2026-10-13T08:00:00Z").getTime()
const KINGS_CROSS = "940GZZLUKSX"

function makeStopPoint(overrides: Partial<TflStopPoint> = {}): TflStopPoint {
  return {
    naptanId: KINGS_CROSS,
    commonName: "King's Cross St. Pancras Underground Station",
    stopType: "NaptanMetroStation",
    modes: ["tube"],
    lat: 51.530663,
    lon: -0.123194,
    ...overrides,
  }
}

function makeSection(
  overrides: Partial<TflRouteSection> = {},
): TflRouteSection {
  return {
    naptanId: KINGS_CROSS,
    lineId: "piccadilly",
    mode: "tube",
    direction: "inbound",
    destinationName: "Heathrow Terminal 5 Underground Station",
    isActive: true,
    ...overrides,
  }
}

const SECTIONS: TflRouteSection[] = [
  makeSection(),
  makeSection({ destinationName: "Uxbridge Underground Station" }),
  makeSection({
    direction: "outbound",
    destinationName: "Cockfosters Underground Station",
  }),
]

function makeArrival(overrides: Partial<TflPrediction> = {}): TflPrediction {
  return {
    id: "1",
    vehicleId: "101",
    naptanId: KINGS_CROSS,
    stationName: "King's Cross St. Pancras Underground Station",
    lineId: "piccadilly",
    lineName: "Piccadilly",
    platformName: "Westbound - Platform 5",
    direction: "inbound",
    destinationName: "Heathrow Terminal 5 Underground Station",
    towards: "Heathrow T5",
    timeToStation: 300,
    timestamp: new Date(NOW).toISOString(),
    expectedArrival: new Date(NOW + ms("5m")).toISOString(),
    modeName: "tube",
    ...overrides,
  }
}

describe("TflService", () => {
  let tflService: TflService
  let mockCacheService: MockProxy<FeedCacheService>
  let mockApiClient: MockProxy<TflApiClient>
  let mockDateTimeService: MockProxy<DateTimeService>
  let rawCacheResults: Map<string, any>

  beforeEach(() => {
    mockCacheService = mock<FeedCacheService>()
    mockApiClient = mock<TflApiClient>()
    mockDateTimeService = mock<DateTimeService>()
    rawCacheResults = new Map()

    mockCacheService.cached.mockImplementation(async (key, fn) => {
      const result = await fn()
      rawCacheResults.set(key, result)
      if (result instanceof Object && "value" in result && "ttl" in result) {
        return result.value
      }

      return result
    })

    tflService = new TflService(
      feedContext,
      mockCacheService,
      mockApiClient,
      mockDateTimeService,
      mock<PinoLogger>(),
    )
  })

  it("cleans TfL station names", () => {
    expect(cleanStationName("Hammersmith (H&C Line) Underground Station")).toBe(
      "Hammersmith",
    )
    expect(cleanStationName("Bank DLR Station")).toBe("Bank")
    expect(cleanStationName("New Cross ELL Rail Station")).toBe("New Cross")
    expect(cleanStationName("London Euston Rail Station")).toBe("London Euston")
  })

  describe("getStop", () => {
    it("finds the requested station inside its hub", async () => {
      // Arrange
      mockApiClient.getStopPoint.mockResolvedValueOnce(
        makeStopPoint({
          naptanId: "HUBKGX",
          commonName: "King's Cross & St Pancras International",
          stopType: "TransportInterchange",
          children: [
            makeStopPoint({
              naptanId: "910GKNGX",
              commonName: "London King's Cross Rail Station",
            }),
            makeStopPoint(),
          ],
        }),
      )

      // Act
      const stop = await tflService.getStop(KINGS_CROSS)

      // Assert
      expect(stop).toEqual({
        stopId: KINGS_CROSS,
        stopCode: null,
        name: "King's Cross St. Pancras",
        lat: 51.530663,
        lon: -0.123194,
      })
    })

    it("throws when the station is not in the returned hierarchy", async () => {
      // Arrange
      mockApiClient.getStopPoint.mockResolvedValueOnce(
        makeStopPoint({ naptanId: "HUBKGX", children: [] }),
      )

      // Act & Assert
      await expect(tflService.getStop(KINGS_CROSS)).rejects.toBeInstanceOf(
        StopNotFoundError,
      )
    })
  })

  describe("getRoutesForStop", () => {
    it("returns one route per line and direction from the route sections", async () => {
      // Arrange
      mockApiClient.getRouteSections.mockResolvedValueOnce([
        ...SECTIONS,
        makeSection({ lineId: "dlr", mode: "dlr" }),
        makeSection({ isActive: false, lineId: "victoria" }),
      ])

      // Act
      const routes = await tflService.getRoutesForStop(KINGS_CROSS)

      // Assert
      expect(routes).toEqual([
        {
          routeId: "piccadilly:inbound",
          name: "Piccadilly",
          color: "0019A8",
          headsigns: ["Heathrow Terminal 5", "Uxbridge"],
        },
        {
          routeId: "piccadilly:outbound",
          name: "Piccadilly",
          color: "0019A8",
          headsigns: ["Cockfosters"],
        },
      ])
    })
  })

  describe("getStopsInArea", () => {
    it("searches stations around the bbox centre and filters to the bbox", async () => {
      // Arrange
      mockApiClient.getStopPointsByRadius.mockResolvedValueOnce([
        makeStopPoint({ naptanId: "inside", lat: 51.53, lon: -0.12 }),
        makeStopPoint({ naptanId: "outside", lat: 51.6, lon: -0.12 }),
      ])

      // Act
      const stops = await tflService.getStopsInArea([
        -0.13, 51.52, -0.11, 51.54,
      ])

      // Assert
      expect(mockApiClient.getStopPointsByRadius).toHaveBeenCalledWith(
        expect.closeTo(51.53),
        expect.closeTo(-0.12),
        expect.any(Number),
        ["NaptanMetroStation", "NaptanRailStation"],
        ["tube"],
      )
      expect(stops.map((stop) => stop.stopId)).toEqual(["inside"])
    })
  })

  describe("getUpcomingTripsForRoutesAtStops", () => {
    beforeEach(() => {
      mockDateTimeService.now.mockReturnValue(new Date(NOW))
      mockApiClient.getStopPoint.mockResolvedValue(makeStopPoint())
      mockApiClient.getRouteSections.mockResolvedValue(SECTIONS)
    })

    function getTrips(
      arrivals: TflPrediction[],
      routes: RouteAtStop[] = [
        { stopId: KINGS_CROSS, routeId: "piccadilly:inbound" },
      ],
    ) {
      mockApiClient.getArrivals.mockResolvedValue(arrivals)
      return tflService.getUpcomingTripsForRoutesAtStops(routes)
    }

    it("maps arrivals to trips for the requested routes", async () => {
      // Act
      const trips = await getTrips([makeArrival()])

      // Assert
      expect(trips).toEqual([
        {
          tripId: "piccadilly-101",
          stopId: KINGS_CROSS,
          routeId: "piccadilly:inbound",
          routeName: "PIC",
          routeColor: "0019A8",
          stopName: "King's Cross St. Pancras",
          headsign: "Heathrow Terminal 5",
          directionId: "inbound",
          arrivalTime: new Date(NOW + ms("5m")),
          departureTime: new Date(NOW + ms("5m")),
          vehicle: "101",
          isRealtime: true,
        },
      ])
    })

    it("uses full line names when short names are turned off", async () => {
      // Arrange
      tflService = new TflService(
        {
          ...feedContext,
          config: { ...feedContext.config, shortLineNames: false },
        },
        mockCacheService,
        mockApiClient,
        mockDateTimeService,
        mock<PinoLogger>(),
      )

      // Act
      const trips = await getTrips([makeArrival()])

      // Assert
      expect(trips.map((t) => t.routeName)).toEqual(["Piccadilly"])
    })

    it("adds the branch to the destination when TfL gives one", async () => {
      // Act
      const trips = await getTrips(
        [
          makeArrival({
            lineId: "northern",
            lineName: "Northern",
            direction: "outbound",
            destinationName: "Edgware Underground Station",
            towards: "Edgware via CX",
          }),
        ],
        [{ stopId: KINGS_CROSS, routeId: "northern:outbound" }],
      )

      // Assert
      expect(trips.map((t) => t.headsign)).toEqual(["Edgware via Charing X"])
    })

    it("works out the direction from the destination when it is missing", async () => {
      // Act
      const trips = await getTrips(
        [
          makeArrival({
            direction: "",
            destinationName: "Cockfosters Underground Station",
          }),
        ],
        [{ stopId: KINGS_CROSS, routeId: "piccadilly:outbound" }],
      )

      // Assert
      expect(trips.map((t) => t.directionId)).toEqual(["outbound"])
    })

    it("works out the direction from other trains on the same platform", async () => {
      // Act
      const trips = await getTrips([
        makeArrival({ vehicleId: "1" }),
        makeArrival({
          vehicleId: "2",
          direction: "",
          destinationName: undefined,
          towards: "Check Front of Train",
        }),
      ])

      // Assert
      expect(trips.map((t) => [t.tripId, t.headsign])).toEqual([
        ["piccadilly-1", "Heathrow Terminal 5"],
        ["piccadilly-2", "Westbound"],
      ])
    })

    it("leaves out arrivals whose direction can't be worked out", async () => {
      // Act
      const trips = await getTrips([
        makeArrival({
          direction: "",
          destinationName: undefined,
          platformName: "Platform 9",
        }),
      ])

      // Assert
      expect(trips).toHaveLength(0)
    })

    it("filters out other directions, past arrivals and other modes", async () => {
      // Act
      const trips = await getTrips([
        makeArrival({ vehicleId: "1", direction: "outbound" }),
        makeArrival({
          vehicleId: "2",
          expectedArrival: new Date(NOW - ms("1m")).toISOString(),
        }),
        makeArrival({ vehicleId: "3", modeName: "bus" }),
        makeArrival({ vehicleId: "4" }),
      ])

      // Assert
      expect(trips.map((t) => t.tripId)).toEqual(["piccadilly-4"])
    })

    it("keeps the previous arrivals when TfL serves an older response", async () => {
      // Arrange
      await getTrips([makeArrival({ vehicleId: "new" })])

      // Act
      const trips = await getTrips([
        makeArrival({
          vehicleId: "old",
          timestamp: new Date(NOW - ms("1m")).toISOString(),
        }),
      ])

      // Assert
      expect(trips.map((t) => t.tripId)).toEqual(["piccadilly-new"])
    })

    it("omits trains that terminate at the stop", async () => {
      // Act
      const trips = await getTrips([
        makeArrival({ vehicleId: "1", destinationNaptanId: KINGS_CROSS }),
        makeArrival({ vehicleId: "2" }),
      ])

      // Assert
      expect(trips.map((t) => t.tripId)).toEqual(["piccadilly-2"])
    })

    it("deduplicates arrivals for the same train", async () => {
      // Act
      const trips = await getTrips([makeArrival(), makeArrival({ id: "2" })])

      // Assert
      expect(trips).toHaveLength(1)
    })

    it("caches arrivals briefly when trains are due, and longer when not", async () => {
      // Act
      await getTrips([makeArrival()])
      const busyTtl = rawCacheResults.get(`arrivals-${KINGS_CROSS}`).ttl
      await getTrips([])
      const quietTtl = rawCacheResults.get(`arrivals-${KINGS_CROSS}`).ttl

      // Assert
      expect(busyTtl).toBe(ms("30s"))
      expect(quietTtl).toBe(ms("2m"))
    })
  })
})
