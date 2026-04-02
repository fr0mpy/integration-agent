import type { DiscoveryResult } from '../../lib/pipeline/discover'
import { petstoreFixture } from './petstore'
import { githubFixture } from './github'
import { stripeFixture } from './stripe'
import { openweatherFixture } from './openweather'
import { notionFixture } from './notion'

export interface Fixture {
  name: string
  discovery: DiscoveryResult
}

export const ALL_FIXTURES: Fixture[] = [
  { name: 'petstore', discovery: petstoreFixture },
  { name: 'github', discovery: githubFixture },
  { name: 'stripe', discovery: stripeFixture },
  { name: 'openweather', discovery: openweatherFixture },
  { name: 'notion', discovery: notionFixture },
]
