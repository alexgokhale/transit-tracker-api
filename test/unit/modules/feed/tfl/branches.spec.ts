import { branchVia } from "src/modules/feed/modules/tfl/branches"

const EUSTON = "940GZZLUEUS"
const KENNINGTON = "940GZZLUKNG"
const ANGEL = "940GZZLUAGL"
const WATERLOO = "940GZZLUWLO"
const EDGWARE = "940GZZLUEGW"
const BATTERSEA = "940GZZBPSUST"

describe("branchVia", () => {
  it("keeps the branch before the Northern line splits", () => {
    expect(branchVia("northern", KENNINGTON, EDGWARE, "Edgware via CX")).toBe(
      " via Charing X",
    )
    expect(branchVia("northern", EUSTON, EDGWARE, "Edgware via Bank")).toBe(
      " via Bank",
    )
  })

  it("drops the branch at stations only that branch serves", () => {
    expect(branchVia("northern", ANGEL, EDGWARE, "Edgware via Bank")).toBe("")
    expect(branchVia("northern", WATERLOO, EDGWARE, "Edgware via CX")).toBe("")
  })

  it("drops the branch for destinations only one branch reaches", () => {
    expect(branchVia("northern", EUSTON, BATTERSEA, "Battersea via CX")).toBe(
      "",
    )
  })

  it("keeps a branch it has no rules for", () => {
    expect(
      branchVia("piccadilly", "940GZZLUHNX", undefined, "Heathrow via T4 Loop"),
    ).toBe(" via T4 Loop")
  })

  it("returns nothing when there is no branch", () => {
    expect(branchVia("victoria", EUSTON, undefined, "Brixton")).toBe("")
    expect(branchVia("victoria", EUSTON, undefined, undefined)).toBe("")
  })
})
