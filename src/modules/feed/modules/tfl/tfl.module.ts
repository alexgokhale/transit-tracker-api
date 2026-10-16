import { Module } from "@nestjs/common"
import { DateTimeModule } from "src/modules/datetime/datetime.module"
import { FeedCacheModule } from "../feed-cache/feed-cache.module"
import { tflApiClientProvider } from "./api-client.provider"
import { TflService } from "./tfl.service"

@Module({
  imports: [FeedCacheModule, DateTimeModule],
  providers: [tflApiClientProvider, TflService],
  exports: [TflService],
})
export class TflModule {}
