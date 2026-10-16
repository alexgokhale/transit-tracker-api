import { altitudeColor } from "src/modules/planes/altitude-color"

describe("altitudeColor", () => {
  it.each([
    [-25, "FF691F"],
    [0, "FF691F"],
    [1800, "FF931F"],
    [3000, "FFAC1F"],
    [11000, "1FFF69"],
    [60000, "FF1F1F"],
  ])("colours %d ft as %s", (altitude, expected) => {
    expect(altitudeColor(altitude)).toBe(expected)
  })
})
