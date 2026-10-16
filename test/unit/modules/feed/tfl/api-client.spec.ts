import { StopNotFoundError } from "src/modules/feed/feed.errors"
import {
  TflApiClient,
  TflApiError,
} from "src/modules/feed/modules/tfl/api-client"

describe("TflApiClient", () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock)
    fetchMock.mockReset()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  function respondWith(status: number, body: unknown = []) {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify(body), { status }),
    )
  }

  it("adds the app key to requests when configured", async () => {
    // Arrange
    respondWith(200)
    const client = new TflApiClient("https://tfl.example.com", "secret")

    // Act
    await client.getArrivals("940GZZLUKSX")

    // Assert
    const url: URL = fetchMock.mock.calls[0][0]
    expect(url.toString()).toBe(
      "https://tfl.example.com/StopPoint/940GZZLUKSX/Arrivals?app_key=secret",
    )
  })

  it("leaves the app key off when not configured", async () => {
    // Arrange
    respondWith(200)
    const client = new TflApiClient("https://tfl.example.com")

    // Act
    await client.getArrivals("940GZZLUKSX")

    // Assert
    const url: URL = fetchMock.mock.calls[0][0]
    expect(url.searchParams.has("app_key")).toBe(false)
  })

  it("throws StopNotFoundError on a 404", async () => {
    // Arrange
    respondWith(404)
    const client = new TflApiClient("https://tfl.example.com")

    // Act & Assert
    await expect(client.getStopPoint("missing")).rejects.toBeInstanceOf(
      StopNotFoundError,
    )
  })

  it("throws TflApiError on other failures", async () => {
    // Arrange
    respondWith(500)
    const client = new TflApiClient("https://tfl.example.com")

    // Act & Assert
    await expect(client.getArrivals("940GZZLUKSX")).rejects.toBeInstanceOf(
      TflApiError,
    )
  })
})
