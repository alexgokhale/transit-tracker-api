import { Module } from "@nestjs/common"
import { env } from "src/env"
import { AdsbApiClient } from "./adsb-client"
import { PlanesController } from "./planes.controller"
import {
  ADSB_API_CLIENT,
  PLANES_CONFIG,
  PlanesConfig,
  PlanesService,
  RUNWAY_DATABASE,
} from "./planes.service"
import { RunwayDatabase } from "./runways"

@Module({
  controllers: [PlanesController],
  providers: [
    PlanesService,
    {
      provide: ADSB_API_CLIENT,
      useFactory: () =>
        new AdsbApiClient(
          env.string("ADSB_BASE_URL", "https://api.adsb.lol")!,
          env.string("ADSB_ROUTES_BASE_URL", "https://api.adsbdb.com")!,
        ),
    },
    {
      provide: PLANES_CONFIG,
      useFactory: (): PlanesConfig => ({
        defaultMaxAltitude: env.int("PLANES_MAX_ALTITUDE", 15000),
        defaultRadius: env.float("PLANES_RADIUS", 10),
      }),
    },
    {
      provide: RUNWAY_DATABASE,
      useFactory: () => {
        const url = env.string(
          "PLANES_RUNWAYS_URL",
          "https://davidmegginson.github.io/ourairports-data/runways.csv",
        )
        return url ? new RunwayDatabase(url) : null
      },
    },
  ],
})
export class PlanesModule {}
