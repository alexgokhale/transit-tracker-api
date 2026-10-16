interface BranchVia {
  redundantAtStations: string[]
  redundantForDestinations: string[]
}

export const TFL_BRANCH_VIAS: Record<string, Record<string, BranchVia>> = {
  northern: {
    "via Bank": {
      redundantAtStations: [
        "940GZZLUKSX", // King's Cross St. Pancras
        "940GZZLUAGL", // Angel
        "940GZZLUODS", // Old Street
        "940GZZLUMGT", // Moorgate
        "940GZZLUBNK", // Bank
        "940GZZLULNB", // London Bridge
        "940GZZLUBOR", // Borough
        "940GZZLUEAC", // Elephant & Castle
      ],
      redundantForDestinations: [],
    },
    "via CX": {
      redundantAtStations: [
        "940GZZLUMTC", // Mornington Crescent
        "940GZZLUWRR", // Warren Street
        "940GZZLUGDG", // Goodge Street
        "940GZZLUTCR", // Tottenham Court Road
        "940GZZLULSQ", // Leicester Square
        "940GZZLUCHX", // Charing Cross
        "940GZZLUEMB", // Embankment
        "940GZZLUWLO", // Waterloo
        "940GZZNEUGST", // Nine Elms
        "940GZZBPSUST", // Battersea Power Station
      ],
      // The Battersea extension only joins the Charing Cross branch
      redundantForDestinations: ["940GZZNEUGST", "940GZZBPSUST"],
    },
  },
  central: {
    "via Newbury Park": {
      redundantAtStations: [
        "940GZZLUWSD", // Wanstead
        "940GZZLURBG", // Redbridge
        "940GZZLUGTH", // Gants Hill
        "940GZZLUNBP", // Newbury Park
        "940GZZLUBKE", // Barkingside
        "940GZZLUFLP", // Fairlop
      ],
      redundantForDestinations: [],
    },
  },
}

// How TfL's "via" text is written on the board
const VIA_LABELS: Record<string, string> = {
  "via CX": "via Charing X",
}

/** What to show as the `via` text */
export function branchVia(
  lineId: string,
  stationId: string,
  destinationId: string | undefined,
  towards: string | undefined,
): string {
  const via = towards?.match(/\bvia\s.+$/)?.[0]

  if (!via) {
    return ""
  }

  const branch = TFL_BRANCH_VIAS[lineId]?.[via]

  if (branch?.redundantAtStations.includes(stationId)) {
    return ""
  }

  if (
    destinationId &&
    branch?.redundantForDestinations.includes(destinationId)
  ) {
    return ""
  }

  return ` ${VIA_LABELS[via] ?? via}`
}
