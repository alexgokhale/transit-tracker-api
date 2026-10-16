import { z } from "zod"

export const TflConfigSchema = z.strictObject({
  baseUrl: z.string().default("https://api.tfl.gov.uk"),
  appKey: z.string().optional(),
  modes: z
    .array(z.string())
    .nonempty()
    .default(["tube", "dlr", "overground", "elizabeth-line"]),
  shortLineNames: z.boolean().default(true),
})

export type TflConfig = z.infer<typeof TflConfigSchema>
