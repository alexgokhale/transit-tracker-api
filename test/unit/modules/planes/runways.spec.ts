import {
  detectRunway,
  parseRunways,
  RunwayAircraft,
  RunwayEnd,
} from "src/modules/planes/runways"

const HEADER =
  '"id","airport_ref","airport_ident","length_ft","width_ft","surface","lighted","closed","le_ident","le_latitude_deg","le_longitude_deg","le_elevation_ft","le_heading_degT","le_displaced_threshold_ft","he_ident","he_latitude_deg","he_longitude_deg","he_elevation_ft","he_heading_degT","he_displaced_threshold_ft"'

// Heathrow's two runways, as published by OurAirports
const HEATHROW = [
  '239399,2434,"EGLL",12799,164,"ASP",1,0,"09L",51.47749,-0.489439,79,90,1007,"27R",51.477681,-0.433227,78,270,',
  '239398,2434,"EGLL",12001,164,"ASP",1,0,"09R",51.46478,-0.486808,75,90,1013,"27L",51.464957,-0.434048,77,270,',
]

const NM_PER_DEGREE_LAT = 60
const NM_PER_DEGREE_LON = 60 * Math.cos((51.47 * Math.PI) / 180)

// A point a number of nautical miles east (or west) and north (or south) of
// a runway end
function offset(end: RunwayEnd, eastNm: number, northNm = 0) {
  return {
    lat: end.lat + northNm / NM_PER_DEGREE_LAT,
    lon: end.lon + eastNm / NM_PER_DEGREE_LON,
  }
}

function aircraft(overrides: Partial<RunwayAircraft>): RunwayAircraft {
  return {
    lat: 0,
    lon: 0,
    track: 270,
    altitude: 1500,
    verticalRate: -700,
    ...overrides,
  }
}

describe("parseRunways", () => {
  it("returns both ends of each open runway with their headings", async () => {
    const ends = await parseRunways(
      [
        HEADER,
        ...HEATHROW,
        '1,1,"XXXX",1000,50,"ASP",0,1,"18",51.0,0.0,0,,,"36",51.01,0.0,0,,',
        '2,2,"YYYY",80,80,"GRS",0,0,"H1",51.0,0.0,0,,,"",,,,,',
      ].join("\n"),
    )

    expect(ends.map((e) => e.ident)).toEqual(["09L", "27R", "09R", "27L"])
    expect(ends[0]).toMatchObject({ airport: "EGLL", elevation: 79 })
    expect(ends[0].heading).toBeCloseTo(89.7, 0)
    expect(ends[1].heading).toBeCloseTo(269.7, 0)
    expect(ends[0].length).toBeCloseTo(2.1, 1)
  })
})

describe("detectRunway", () => {
  let ends: RunwayEnd[]
  let r27R: RunwayEnd
  let r27L: RunwayEnd

  beforeAll(async () => {
    ends = await parseRunways([HEADER, ...HEATHROW].join("\n"))
    r27R = ends.find((e) => e.ident === "27R")!
    r27L = ends.find((e) => e.ident === "27L")!
  })

  it("spots a plane on approach to the northern runway", () => {
    const plane = aircraft(offset(r27R, 5))

    expect(detectRunway(plane, ends)).toEqual({
      airport: "EGLL",
      runway: "27R",
      phase: "arriving",
    })
  })

  it("picks the parallel runway whose centre line is closest", () => {
    const plane = aircraft(offset(r27L, 5))

    expect(detectRunway(plane, ends)?.runway).toBe("27L")
  })

  it("spots a plane that has just taken off eastwards from 09R", () => {
    // Past the eastern end of the southern runway, climbing away from it
    const plane = aircraft({
      ...offset(r27L, 2),
      track: 90,
      verticalRate: 2000,
    })

    expect(detectRunway(plane, ends)).toEqual({
      airport: "EGLL",
      runway: "09R",
      phase: "departing",
    })
  })

  it("ignores planes not lined up with a runway", () => {
    expect(
      detectRunway(aircraft({ ...offset(r27R, 5), track: 180 }), ends),
    ).toBeNull()
    expect(detectRunway(aircraft(offset(r27R, 5, 2)), ends)).toBeNull()
  })

  it("ignores planes too far out or too high", () => {
    expect(detectRunway(aircraft(offset(r27R, 20)), ends)).toBeNull()
    expect(
      detectRunway(aircraft({ ...offset(r27R, 5), altitude: 9000 }), ends),
    ).toBeNull()
  })

  it("ignores a descending plane that has flown past the runway", () => {
    // East of the airport but heading east, so it can't be landing on 09L
    const plane = aircraft({ ...offset(r27R, 3), track: 90 })

    expect(detectRunway(plane, ends)).toBeNull()
  })

  it("needs a track and vertical rate", () => {
    expect(
      detectRunway(aircraft({ ...offset(r27R, 5), track: null }), ends),
    ).toBeNull()
    expect(
      detectRunway(aircraft({ ...offset(r27R, 5), verticalRate: null }), ends),
    ).toBeNull()
  })
})
