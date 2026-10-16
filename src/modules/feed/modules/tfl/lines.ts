interface TflLine {
  name: string
  shortName: string
  color: string
}

// RGB values from the TfL Colour Standard, Issue 11 (August 2026):
// https://content.tfl.gov.uk/tfl-colour-standard.pdf
export const TFL_LINES: Record<string, TflLine> = {
  bakerloo: { name: "Bakerloo", shortName: "BAK", color: "B26300" },
  central: { name: "Central", shortName: "CEN", color: "DC241F" },
  circle: { name: "Circle", shortName: "CIR", color: "FFC80A" },
  district: { name: "District", shortName: "DIS", color: "007D32" },
  "hammersmith-city": {
    name: "Hammersmith & City",
    shortName: "H&C",
    color: "F589A6",
  },
  jubilee: { name: "Jubilee", shortName: "JBL", color: "838D93" },
  metropolitan: { name: "Metropolitan", shortName: "MET", color: "9B0058" },
  northern: { name: "Northern", shortName: "NOR", color: "000000" },
  piccadilly: { name: "Piccadilly", shortName: "PIC", color: "0019A8" },
  victoria: { name: "Victoria", shortName: "VIC", color: "039BE5" },
  "waterloo-city": {
    name: "Waterloo & City",
    shortName: "W&C",
    color: "76D0BD",
  },
  dlr: { name: "DLR", shortName: "DLR", color: "00AFAD" },
  elizabeth: { name: "Elizabeth", shortName: "ELZ", color: "60399E" },
  liberty: { name: "Liberty", shortName: "LIB", color: "5D6061" },
  lioness: { name: "Lioness", shortName: "LIO", color: "FAA61A" },
  mildmay: { name: "Mildmay", shortName: "MLD", color: "0077AD" },
  suffragette: { name: "Suffragette", shortName: "SUF", color: "5BBD72" },
  weaver: { name: "Weaver", shortName: "WEA", color: "823A62" },
  windrush: { name: "Windrush", shortName: "WIN", color: "ED1B00" },
  tram: { name: "Tram", shortName: "TRM", color: "5FB526" },
}
