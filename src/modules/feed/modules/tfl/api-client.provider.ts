import { FactoryProvider } from "@nestjs/common"
import { FEED_CONTEXT } from "../../feed-context"
import type { FeedContext } from "../../interfaces/feed-provider.interface"
import { TflApiClient } from "./api-client"
import { TflConfig } from "./config"

export const tflApiClientProvider: FactoryProvider<TflApiClient> = {
  provide: TflApiClient,
  inject: [FEED_CONTEXT],
  useFactory: ({ config }: FeedContext<TflConfig>) =>
    new TflApiClient(config.baseUrl, config.appKey),
}
