import type { DiscoveryResult } from '../../lib/pipeline/discover'

export const petstoreFixture: DiscoveryResult = {
  apiName: 'Petstore',
  apiDescription: 'A sample API that manages pets in a pet store',
  baseUrl: 'https://petstore.example.com/v1',
  authMethod: 'apiKey',
  authHeader: 'X-API-Key',
  endpointCount: 5,
  endpoints: [
    {
      method: 'GET',
      path: '/pets',
      operationId: 'listPets',
      summary: 'List all pets',
      description: 'Returns a paginated list of pets in the store, optionally filtered by status.',
      parameters: [
        { name: 'limit', in: 'query', required: false, description: 'Maximum number of items to return (1-100)', type: 'integer' },
        { name: 'status', in: 'query', required: false, description: 'Filter by pet status', type: 'string' },
      ],
      requestBody: null,
      responses: { '200': 'A paginated list of pets' },
    },
    {
      method: 'POST',
      path: '/pets',
      operationId: 'createPet',
      summary: 'Create a pet',
      description: 'Adds a new pet to the store inventory.',
      parameters: [],
      requestBody: {
        required: true,
        contentType: 'application/json',
        description: 'Pet object to add to the store',
        schema: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'The name of the pet', nullable: false, items: null, properties: null },
            species: { type: 'string', description: 'Species of the pet (dog, cat, bird, etc.)', nullable: false, items: null, properties: null },
            age: { type: 'integer', description: 'Age of the pet in years', nullable: false, items: null, properties: null },
            status: { type: 'string', description: 'Availability status: available, pending, or sold', nullable: false, items: null, properties: null },
          },
          required: ['name', 'species'],
        },
      },
      responses: { '201': 'Pet created successfully' },
    },
    {
      method: 'GET',
      path: '/pets/{petId}',
      operationId: 'getPet',
      summary: 'Get a pet by ID',
      description: 'Returns detailed information about a specific pet.',
      parameters: [
        { name: 'petId', in: 'path', required: true, description: 'The unique identifier of the pet', type: 'string' },
      ],
      requestBody: null,
      responses: { '200': 'Pet details', '404': 'Pet not found' },
    },
    {
      method: 'PUT',
      path: '/pets/{petId}',
      operationId: 'updatePet',
      summary: 'Update a pet',
      description: 'Updates the details of an existing pet.',
      parameters: [
        { name: 'petId', in: 'path', required: true, description: 'The unique identifier of the pet', type: 'string' },
      ],
      requestBody: {
        required: true,
        contentType: 'application/json',
        description: 'Updated pet fields',
        schema: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'The name of the pet', nullable: false, items: null, properties: null },
            status: { type: 'string', description: 'Availability status: available, pending, or sold', nullable: false, items: null, properties: null },
          },
          required: [],
        },
      },
      responses: { '200': 'Pet updated' },
    },
    {
      method: 'DELETE',
      path: '/pets/{petId}',
      operationId: 'deletePet',
      summary: 'Delete a pet',
      description: 'Removes a pet from the store.',
      parameters: [
        { name: 'petId', in: 'path', required: true, description: 'The unique identifier of the pet', type: 'string' },
      ],
      requestBody: null,
      responses: { '204': 'Pet deleted' },
    },
  ],
  groups: {
    pets: [],
  },
  warnings: [],
}
