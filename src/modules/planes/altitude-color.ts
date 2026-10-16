// Hue stops from tar1090's altitude colour scale, so the board matches what
// ADS-B maps show: orange near the ground, yellow, then green from 11,000 ft.
// https://github.com/wiedehopf/tar1090/blob/master/html/defaults.js
const HUE_STOPS: [altitude: number, hue: number][] = [
  [0, 20],
  [2000, 32.5],
  [4000, 43],
  [6000, 54],
  [8000, 72],
  [9000, 85],
  [11000, 140],
  [40000, 300],
  [51000, 360],
]

function hueForAltitude(altitude: number): number {
  const [first] = HUE_STOPS
  const last = HUE_STOPS[HUE_STOPS.length - 1]
  if (altitude <= first[0]) return first[1]
  if (altitude >= last[0]) return last[1]

  const upper = HUE_STOPS.findIndex(([alt]) => alt >= altitude)
  const [alt0, hue0] = HUE_STOPS[upper - 1]
  const [alt1, hue1] = HUE_STOPS[upper]
  return hue0 + ((hue1 - hue0) * (altitude - alt0)) / (alt1 - alt0)
}

/**
 * Hex colour (without #) for an altitude in feet. Unlike tar1090 it uses
 * full brightness, since it's shown on an LED matrix rather than a map.
 */
export function altitudeColor(altitude: number): string {
  const hue = hueForAltitude(altitude) % 360
  const saturation = 0.88

  const sector = hue / 60
  const chroma = saturation
  const x = chroma * (1 - Math.abs((sector % 2) - 1))
  const [r, g, b] = [
    [chroma, x, 0],
    [x, chroma, 0],
    [0, chroma, x],
    [0, x, chroma],
    [x, 0, chroma],
    [chroma, 0, x],
  ][Math.floor(sector)]
  const m = 1 - chroma

  return [r, g, b]
    .map((c) =>
      Math.round((c + m) * 255)
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")
    .toUpperCase()
}
