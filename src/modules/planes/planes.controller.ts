import {
  BadRequestException,
  Controller,
  Get,
  ParseFloatPipe,
  Query,
} from "@nestjs/common"
import { ApiOperation, ApiQuery } from "@nestjs/swagger"
import { Plane, PlanesService } from "./planes.service"

// adsb.lol's point query is capped at 250 nm
const MAX_RADIUS_NM = 250

function assertInRange(name: string, value: number, min: number, max: number) {
  if (value < min || value > max) {
    throw new BadRequestException(`${name} must be between ${min} and ${max}`)
  }
}

@Controller("planes")
export class PlanesController {
  constructor(private readonly planesService: PlanesService) {}

  @Get("closest")
  @ApiOperation({
    description:
      "Get the closest airborne plane to a point, below an altitude threshold",
  })
  @ApiQuery({ name: "lat", type: Number, example: 51.47 })
  @ApiQuery({ name: "lon", type: Number, example: -0.4543 })
  @ApiQuery({
    name: "maxAltitude",
    type: Number,
    required: false,
    description: "Ignore planes above this altitude, in feet",
    example: 15000,
  })
  @ApiQuery({
    name: "radius",
    type: Number,
    required: false,
    description: "Search radius in nautical miles",
    example: 10,
  })
  async getClosestPlane(
    @Query("lat", ParseFloatPipe) lat: number,
    @Query("lon", ParseFloatPipe) lon: number,
    @Query("maxAltitude", new ParseFloatPipe({ optional: true }))
    maxAltitude?: number,
    @Query("radius", new ParseFloatPipe({ optional: true })) radius?: number,
  ): Promise<{ plane: Plane | null }> {
    assertInRange("lat", lat, -90, 90)
    assertInRange("lon", lon, -180, 180)
    if (maxAltitude !== undefined) {
      assertInRange("maxAltitude", maxAltitude, 0, 100000)
    }
    if (radius !== undefined) {
      assertInRange("radius", radius, 0.1, MAX_RADIUS_NM)
    }

    const plane = await this.planesService.getClosestPlane({
      lat,
      lon,
      maxAltitude,
      radius,
    })
    return { plane }
  }
}
