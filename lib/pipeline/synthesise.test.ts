import { describe, it, expect, vi, beforeEach } from 'vitest'
import { synthesiseTools } from './synthesise'
import type { DiscoveryResult } from './discover'

const mockDiscovery: DiscoveryResult = {
  apiName: 'Petstore',
  apiDescription: 'A sample API for pets',
  baseUrl: 'https://petstore.swagger.io/v2',
  authMethod: 'apiKey',
  authHeader: 'api_key',
  endpointCount: 2,
  endpoints: [
    {
      method: 'GET',
      path: '/pets',
      operationId: 'listPets',
      summary: 'List all pets',
      description: 'Returns all pets from the store',
      parameters: [
        { name: 'limit', in: 'query', required: false, description: 'How many items to return', type: 'integer' },
      ],
      requestBody: null,
      responses: { '200': 'A list of pets' },
    },
    {
      method: 'POST',
      path: '/pets',
      operationId: 'createPet',
      summary: 'Create a pet',
      description: 'Creates a new pet in the store',
      parameters: [],
      requestBody: {
        required: true,
        contentType: 'application/json',
        description: 'Pet to create',
        schema: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Pet name', nullable: false, items: null, properties: null },
          },
          required: ['name'],
        },
      },
      responses: { '201': 'Pet created' },
    },
  ],
  groups: { pets: [] },
  warnings: [],
}

// Index-based LLM output — no structural fields (httpPath, httpMethod, auth, baseUrl)
const validLLMOutput = {
  tools: [
    {
      endpointIndex: 0,
      name: 'list_pets',
      title: 'List Pets',
      description: 'Call this when you need to retrieve all available pets from the store. Returns an array of pet objects.',
      propertyDescriptions: {
        limit: 'Maximum number of pets to return at once',
      },
      authRequired: true,
    },
  ],
}

vi.mock('ai', () => ({
  generateText: vi.fn(),
  Output: {
    object: vi.fn(() => ({})),
  },
}))

vi.mock('../ai/gateway', () => ({
  synthesisModel: vi.fn(() => 'mock-model'),
  buildTags: vi.fn(() => []),
}))

describe('synthesiseTools', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('assembles tool from spec — httpPath/httpMethod come from discovered endpoint', async () => {
    const { generateText } = await import('ai')
    const mockGenerateText = vi.mocked(generateText)
    mockGenerateText.mockResolvedValueOnce({ output: validLLMOutput } as never)

    const result = await synthesiseTools(mockDiscovery)
    expect(result.tools).toHaveLength(1)
    expect(result.tools[0].name).toBe('list_pets')
    // Structural fields come from spec, not LLM
    expect(result.tools[0].httpMethod).toBe('GET')
    expect(result.tools[0].httpPath).toBe('/pets')
    expect(result.tools[0].inputSchema.properties.limit.type).toBe('number')  // integer → number
    expect(result.tools[0].inputSchema.properties.limit.description).toBe('Maximum number of pets to return at once')
  })

  it('injects baseUrl, authMethod, authHeader from discovery — LLM has no say', async () => {
    const { generateText } = await import('ai')
    const mockGenerateText = vi.mocked(generateText)
    mockGenerateText.mockResolvedValueOnce({ output: validLLMOutput } as never)

    const result = await synthesiseTools(mockDiscovery)
    expect(result.baseUrl).toBe('https://petstore.swagger.io/v2')
    expect(result.authMethod).toBe('apiKey')
    expect(result.authHeader).toBe('api_key')
  })

  it('drops tool and retries when endpointIndex is out of bounds', async () => {
    const { generateText } = await import('ai')
    const mockGenerateText = vi.mocked(generateText)

    const outOfBoundsOutput = {
      tools: [{ ...validLLMOutput.tools[0], endpointIndex: 99 }],
    }
    mockGenerateText
      .mockResolvedValueOnce({ output: outOfBoundsOutput } as never)
      .mockResolvedValueOnce({ output: validLLMOutput } as never)

    const result = await synthesiseTools(mockDiscovery)
    expect(result.tools).toHaveLength(1)
    expect(mockGenerateText).toHaveBeenCalledTimes(2)
  })

  it('retries on null output', async () => {
    const { generateText } = await import('ai')
    const mockGenerateText = vi.mocked(generateText)

    mockGenerateText
      .mockResolvedValueOnce({ output: null } as never)
      .mockResolvedValueOnce({ output: validLLMOutput } as never)

    const result = await synthesiseTools(mockDiscovery)
    expect(result.tools).toHaveLength(1)
    expect(mockGenerateText).toHaveBeenCalledTimes(2)
  })

  it('retries on error and includes error context', async () => {
    const { generateText } = await import('ai')
    const mockGenerateText = vi.mocked(generateText)

    mockGenerateText
      .mockRejectedValueOnce(new Error('Zod validation failed'))
      .mockResolvedValueOnce({ output: validLLMOutput } as never)

    const result = await synthesiseTools(mockDiscovery)
    expect(result.tools).toHaveLength(1)
    expect(mockGenerateText).toHaveBeenCalledTimes(2)

    const secondCallPrompt = mockGenerateText.mock.calls[1][0].prompt as string
    expect(secondCallPrompt).toContain('Zod validation failed')
  })

  it('throws after exhausting all retries', async () => {
    const { generateText } = await import('ai')
    const mockGenerateText = vi.mocked(generateText)

    mockGenerateText.mockResolvedValue({ output: null } as never)

    await expect(synthesiseTools(mockDiscovery)).rejects.toThrow(
      /Synthesis failed after 3 attempts/,
    )
    expect(mockGenerateText).toHaveBeenCalledTimes(3)
  })
})
