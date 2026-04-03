import { describe, it, expect, vi } from 'vitest'
import { discoverEndpoints, enrichDiscovery, needsEnrichment } from './discover'

const mockGenerateText = vi.fn()

vi.mock('ai', () => ({
  generateText: (...args: unknown[]) => mockGenerateText(...args),
  Output: { object: (opts: unknown) => opts },
}))

const minimalSpec = {
  openapi: '3.0.0',
  info: { title: 'Pet Store', description: 'A sample API for pets' },
  servers: [{ url: 'https://petstore.example.com/v1' }],
  components: {
    securitySchemes: {
      bearerAuth: { type: 'http', scheme: 'bearer' },
    },
  },
  paths: {
    '/pets': {
      get: {
        operationId: 'listPets',
        summary: 'List all pets',
        description: 'Returns all pets in the store',
        parameters: [
          { name: 'limit', in: 'query', required: false, description: 'Max items', schema: { type: 'integer' } },
        ],
        responses: { '200': { description: 'A list of pets' } },
      },
      post: {
        operationId: 'createPet',
        summary: 'Create a pet',
        requestBody: {
          required: true,
          content: { 'application/json': {} },
          description: 'Pet to add',
        },
        responses: {
          '201': { description: 'Pet created' },
          '400': { description: 'Bad request' },
        },
      },
    },
    '/pets/{petId}': {
      parameters: [
        { name: 'petId', in: 'path', required: true, description: 'The pet ID', schema: { type: 'string' } },
      ],
      get: {
        operationId: 'getPet',
        summary: 'Get a pet by ID',
        responses: { '200': { description: 'A pet' } },
      },
      delete: {
        operationId: 'deletePet',
        summary: 'Delete a pet',
        responses: { '204': { description: 'Deleted' } },
      },
    },
  },
}

describe('discoverEndpoints', async () => {
  it('extracts API metadata', async () => {
    const result = await discoverEndpoints(minimalSpec)
    expect(result.apiName).toBe('Pet Store')
    expect(result.apiDescription).toBe('A sample API for pets')
    expect(result.baseUrl).toBe('https://petstore.example.com/v1')
    expect(result.authMethod).toBe('bearer')
    expect(result.authHeader).toBe('Authorization')
  })

  it('extracts all endpoints', async () => {
    const result = await discoverEndpoints(minimalSpec)
    expect(result.endpointCount).toBe(4)
    expect(result.endpoints.map((e) => e.operationId)).toEqual([
      'listPets', 'createPet', 'getPet', 'deletePet',
    ])
  })

  it('extracts methods correctly', async () => {
    const result = await discoverEndpoints(minimalSpec)
    const methods = result.endpoints.map((e) => e.method)
    expect(methods).toEqual(['GET', 'POST', 'GET', 'DELETE'])
  })

  it('merges path-level and operation-level parameters', async () => {
    const result = await discoverEndpoints(minimalSpec)
    const getPet = result.endpoints.find((e) => e.operationId === 'getPet')!
    expect(getPet.parameters).toHaveLength(1)
    expect(getPet.parameters[0].name).toBe('petId')
    expect(getPet.parameters[0].in).toBe('path')
    expect(getPet.parameters[0].required).toBe(true)
  })

  it('extracts query parameters', async () => {
    const result = await discoverEndpoints(minimalSpec)
    const listPets = result.endpoints.find((e) => e.operationId === 'listPets')!
    expect(listPets.parameters).toHaveLength(1)
    expect(listPets.parameters[0].name).toBe('limit')
    expect(listPets.parameters[0].type).toBe('integer')
  })

  it('extracts request body info', async () => {
    const result = await discoverEndpoints(minimalSpec)
    const createPet = result.endpoints.find((e) => e.operationId === 'createPet')!
    expect(createPet.requestBody).toEqual({
      required: true,
      contentType: 'application/json',
      description: 'Pet to add',
      schema: null,
    })
  })

  it('extracts response descriptions', async () => {
    const result = await discoverEndpoints(minimalSpec)
    const createPet = result.endpoints.find((e) => e.operationId === 'createPet')!
    expect(createPet.responses).toEqual({
      '201': 'Pet created',
      '400': 'Bad request',
    })
  })

  it('groups endpoints by top-level path segment', async () => {
    const result = await discoverEndpoints(minimalSpec)
    expect(Object.keys(result.groups)).toEqual(['pets'])
    expect(result.groups['pets']).toHaveLength(4)
  })

  it('handles apiKey auth', async () => {
    const spec = {
      ...minimalSpec,
      components: {
        securitySchemes: {
          apiKey: { type: 'apiKey', in: 'header', name: 'X-API-Key' },
        },
      },
    }
    const result = await discoverEndpoints(spec)
    expect(result.authMethod).toBe('apiKey')
    expect(result.authHeader).toBe('X-API-Key')
  })

  it('handles oauth2 auth', async () => {
    const spec = {
      ...minimalSpec,
      components: {
        securitySchemes: {
          oauth: { type: 'oauth2', flows: {} },
        },
      },
    }
    const result = await discoverEndpoints(spec)
    expect(result.authMethod).toBe('oauth2')
  })

  it('handles no auth', async () => {
    const spec = { ...minimalSpec, components: {} }
    const result = await discoverEndpoints(spec)
    expect(result.authMethod).toBe('none')
    expect(result.authHeader).toBeNull()
  })

  it('handles Swagger 2.x specs', async () => {
    const swagger2 = {
      swagger: '2.0',
      info: { title: 'Legacy API', description: 'Old spec' },
      host: 'api.example.com',
      basePath: '/v2',
      schemes: ['https'],
      securityDefinitions: {
        api_key: { type: 'apiKey', in: 'header', name: 'Authorization' },
      },
      paths: {
        '/items': {
          get: {
            operationId: 'listItems',
            summary: 'List items',
            parameters: [
              { name: 'page', in: 'query', type: 'integer', required: false, description: 'Page number' },
            ],
            responses: { '200': { description: 'OK' } },
          },
        },
      },
    }
    const result = await discoverEndpoints(swagger2)
    expect(result.apiName).toBe('Legacy API')
    expect(result.baseUrl).toBe('https://api.example.com/v2')
    expect(result.authMethod).toBe('apiKey')
    expect(result.endpointCount).toBe(1)
    expect(result.endpoints[0].parameters[0].type).toBe('integer')
  })

  it('handles empty spec gracefully', async () => {
    const result = await discoverEndpoints({ openapi: '3.0.0' })
    expect(result.apiName).toBe('Untitled API')
    expect(result.baseUrl).toBe('')
    expect(result.authMethod).toBe('none')
    expect(result.endpointCount).toBe(0)
    expect(result.endpoints).toEqual([])
  })

  it('resolves $ref pointers in parameters', async () => {
    const spec = {
      openapi: '3.0.0',
      info: { title: 'Ref Test' },
      paths: {
        '/users/{userId}': {
          get: {
            operationId: 'getUser',
            summary: 'Get a user',
            parameters: [
              { $ref: '#/components/parameters/UserId' },
            ],
            responses: { '200': { description: 'OK' } },
          },
          post: {
            operationId: 'updateUser',
            summary: 'Update a user',
            parameters: [
              { $ref: '#/components/parameters/UserId' },
            ],
            requestBody: {
              $ref: '#/components/requestBodies/UserBody',
            },
            responses: { '200': { description: 'Updated' } },
          },
        },
      },
      components: {
        parameters: {
          UserId: {
            name: 'userId',
            in: 'path',
            required: true,
            description: 'The user ID',
            schema: { type: 'string' },
          },
        },
        requestBodies: {
          UserBody: {
            required: true,
            description: 'User data',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    name: { type: 'string' },
                    email: { type: 'string' },
                  },
                },
              },
            },
          },
        },
      },
    }

    const result = await discoverEndpoints(spec)
    expect(result.warnings).toHaveLength(0)

    const getUser = result.endpoints.find((e) => e.operationId === 'getUser')!
    expect(getUser.parameters).toHaveLength(1)
    expect(getUser.parameters[0].name).toBe('userId')
    expect(getUser.parameters[0].in).toBe('path')
    expect(getUser.parameters[0].required).toBe(true)

    const updateUser = result.endpoints.find((e) => e.operationId === 'updateUser')!
    expect(updateUser.requestBody).not.toBeNull()
    expect(updateUser.requestBody!.contentType).toBe('application/json')
    expect(updateUser.requestBody!.description).toBe('User data')
  })

  it('extracts request body schema properties', async () => {
    const spec = {
      openapi: '3.0.0',
      info: { title: 'Schema Test' },
      paths: {
        '/orders': {
          post: {
            operationId: 'createOrder',
            summary: 'Create an order',
            requestBody: {
              required: true,
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      item: { type: 'string', description: 'Item name' },
                      quantity: { type: 'integer', description: 'How many' },
                      address: {
                        type: 'object',
                        description: 'Shipping address',
                        properties: {
                          street: { type: 'string', description: 'Street' },
                          city: { type: 'string', description: 'City' },
                        },
                      },
                      tags: {
                        type: 'array',
                        description: 'Order tags',
                        items: { type: 'string', description: 'Tag' },
                      },
                    },
                    required: ['item', 'quantity'],
                  },
                },
              },
            },
            responses: { '201': { description: 'Created' } },
          },
        },
      },
    }

    const result = await discoverEndpoints(spec)
    const order = result.endpoints[0]
    const schema = order.requestBody!.schema!

    expect(schema.type).toBe('object')
    expect(schema.required).toEqual(['item', 'quantity'])
    expect(schema.properties.item.type).toBe('string')
    expect(schema.properties.quantity.type).toBe('integer')

    // Nested object at depth 1
    expect(schema.properties.address.type).toBe('object')
    expect(schema.properties.address.properties).not.toBeNull()
    expect(schema.properties.address.properties!.street.type).toBe('string')

    // Array with items
    expect(schema.properties.tags.type).toBe('array')
    expect(schema.properties.tags.items).not.toBeNull()
    expect(schema.properties.tags.items!.type).toBe('string')
  })

  it('filters deprecated endpoints', async () => {
    const spec = {
      openapi: '3.0.0',
      info: { title: 'Deprecation Test' },
      paths: {
        '/active': {
          get: {
            operationId: 'getActive',
            summary: 'Active endpoint',
            responses: { '200': { description: 'OK' } },
          },
        },
        '/old': {
          get: {
            operationId: 'getOld',
            summary: 'Deprecated endpoint',
            deprecated: true,
            responses: { '200': { description: 'OK' } },
          },
          post: {
            operationId: 'createOld',
            summary: 'Also deprecated',
            deprecated: true,
            responses: { '201': { description: 'Created' } },
          },
        },
        '/also-active': {
          get: {
            operationId: 'getAlsoActive',
            summary: 'Another active endpoint',
            responses: { '200': { description: 'OK' } },
          },
        },
      },
    }

    const result = await discoverEndpoints(spec)
    expect(result.endpointCount).toBe(2)
    expect(result.endpoints.map((e) => e.operationId)).toEqual(['getActive', 'getAlsoActive'])
    expect(result.warnings).toContain('Filtered 2 deprecated endpoints')
  })
})

describe('enrichDiscovery', () => {
  function makeResult(
    overrides: Partial<{
      endpoints: Array<{ method: string; path: string; operationId: string | null; summary: string }>
    }> = {},
  ) {
    const endpoints = (overrides.endpoints ?? [
      { method: 'GET', path: '/pets', operationId: 'listPets', summary: 'List all pets in the store' },
      { method: 'POST', path: '/pets', operationId: 'createPet', summary: 'Create a new pet entry' },
    ]).map((e) => ({
      ...e,
      description: '',
      parameters: [],
      requestBody: null,
      responses: {},
    }))

    return {
      apiName: 'Test API',
      apiDescription: '',
      baseUrl: 'https://api.test.com',
      authMethod: 'bearer' as const,
      authHeader: 'Authorization',
      endpointCount: endpoints.length,
      endpoints,
      groups: {},
      warnings: [],
    }
  }

  it('skips enrichment for clean small specs', async () => {
    const result = makeResult()
    expect(needsEnrichment(result)).toBe(false)

    const enriched = await enrichDiscovery(result)
    expect(enriched).toBe(result) // same reference, no copy
  })

  it('detects missing operationIds', () => {
    const result = makeResult({
      endpoints: [
        { method: 'GET', path: '/items', operationId: null, summary: 'List all items available' },
      ],
    })
    expect(needsEnrichment(result)).toBe(true)
  })

  it('detects vague summaries', () => {
    const result = makeResult({
      endpoints: [
        { method: 'GET', path: '/items', operationId: 'listItems', summary: 'List' },
      ],
    })
    expect(needsEnrichment(result)).toBe(true)
  })

  it('detects >50 endpoints', () => {
    const endpoints = Array.from({ length: 55 }, (_, i) => ({
      method: 'GET',
      path: `/resource${i}`,
      operationId: `getResource${i}`,
      summary: `Get resource number ${i} from the API`,
    }))
    const result = makeResult({ endpoints })
    expect(needsEnrichment(result)).toBe(true)
  })

  it('returns original result with warning on LLM failure', async () => {
    mockGenerateText.mockRejectedValueOnce(new Error('API key missing'))

    const result = makeResult({
      endpoints: [
        { method: 'GET', path: '/items', operationId: null, summary: 'List all items available' },
      ],
    })

    const enriched = await enrichDiscovery(result)
    expect(enriched.endpoints).toEqual(result.endpoints)
    expect(enriched.warnings).toContain('Enrichment failed — using raw discovery results')
  })

  it('merges LLM enrichment back into endpoints', async () => {
    mockGenerateText.mockResolvedValueOnce({
      experimental_output: {
        selectedEndpoints: [
          { path: '/items', method: 'GET', operationId: 'listItems', summary: 'List all available items in the store' },
        ],
      },
    })

    const result = makeResult({
      endpoints: [
        { method: 'GET', path: '/items', operationId: null, summary: 'List' },
      ],
    })

    const enriched = await enrichDiscovery(result)
    expect(enriched.endpoints[0].operationId).toBe('listItems')
    expect(enriched.endpoints[0].summary).toBe('List all available items in the store')
  })

  it('resolves relative server URL against specUrl', async () => {
    const spec = {
      openapi: '3.0.0',
      info: { title: 'Test', description: 'Test API' },
      servers: [{ url: '/api/v3' }],
      paths: {},
    }
    const result = await discoverEndpoints(spec, 'https://petstore3.swagger.io/api/v3/openapi.json')
    expect(result.baseUrl).toBe('https://petstore3.swagger.io/api/v3')
  })
})
