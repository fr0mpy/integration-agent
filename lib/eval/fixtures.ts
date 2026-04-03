import type { DiscoveryResult } from '../pipeline/discover'

/**
 * Eval fixtures — frozen DiscoveryResult objects with known expected traits.
 * Used to detect regression when prompts, models, or schemas change.
 */

export interface ExpectedTraits {
  minTools: number
  maxTools: number
  requiredPaths: string[]
  expectedAuth: string
  expectedBaseUrl: string
}

export interface EvalFixture {
  name: string
  discovery: DiscoveryResult
  expected: ExpectedTraits
}

// ── Fixture 1: CRUD API with bearer auth ────────────────────────────────────

export const tasksCrud: EvalFixture = {
  name: 'Tasks CRUD API',
  discovery: {
    apiName: 'Tasks API',
    apiDescription: 'A simple task management API',
    baseUrl: 'https://api.tasks.example.com',
    authMethod: 'bearer',
    authHeader: 'Authorization',
    endpointCount: 4,
    endpoints: [
      {
        method: 'GET',
        path: '/tasks',
        operationId: 'listTasks',
        summary: 'List all tasks with optional status filter',
        description: 'Returns a paginated list of tasks',
        parameters: [
          { name: 'status', in: 'query', required: false, description: 'Filter by task status', type: 'string' },
        ],
        requestBody: null,
        responses: { '200': 'List of tasks', '401': 'Unauthorized' },
      },
      {
        method: 'POST',
        path: '/tasks',
        operationId: 'createTask',
        summary: 'Create a new task',
        description: 'Creates a task with a title and optional description',
        parameters: [],
        requestBody: {
          required: true,
          contentType: 'application/json',
          description: 'Task to create',
          schema: {
            type: 'object',
            properties: {
              title: { type: 'string', description: 'Task title', nullable: false, items: null, properties: null },
              description: { type: 'string', description: 'Task description', nullable: true, items: null, properties: null },
            },
            required: ['title'],
          },
        },
        responses: { '201': 'Created task', '400': 'Validation error' },
      },
      {
        method: 'GET',
        path: '/tasks/{id}',
        operationId: 'getTask',
        summary: 'Get a task by ID',
        description: 'Returns a single task by its identifier',
        parameters: [
          { name: 'id', in: 'path', required: true, description: 'Task ID', type: 'string' },
        ],
        requestBody: null,
        responses: { '200': 'Task details', '404': 'Not found' },
      },
      {
        method: 'DELETE',
        path: '/tasks/{id}',
        operationId: 'deleteTask',
        summary: 'Delete a task by ID',
        description: 'Permanently removes a task',
        parameters: [
          { name: 'id', in: 'path', required: true, description: 'Task ID', type: 'string' },
        ],
        requestBody: null,
        responses: { '204': 'Deleted', '404': 'Not found' },
      },
    ],
    groups: { tasks: [] },
    warnings: [],
  },
  expected: {
    minTools: 3,
    maxTools: 5,
    requiredPaths: ['/tasks', '/tasks/{id}'],
    expectedAuth: 'bearer',
    expectedBaseUrl: 'https://api.tasks.example.com',
  },
}

// ── Fixture 2: Read-only API with apiKey auth ───────────────────────────────

export const weatherReadonly: EvalFixture = {
  name: 'Weather Readonly API',
  discovery: {
    apiName: 'Weather Service',
    apiDescription: 'Public weather data with API key authentication',
    baseUrl: 'https://api.weather.example.com/v2',
    authMethod: 'apiKey',
    authHeader: 'X-API-Key',
    endpointCount: 3,
    endpoints: [
      {
        method: 'GET',
        path: '/current',
        operationId: 'getCurrentWeather',
        summary: 'Get current weather conditions for a location',
        description: 'Returns current temperature, humidity, and conditions',
        parameters: [
          { name: 'lat', in: 'query', required: true, description: 'Latitude coordinate', type: 'number' },
          { name: 'lon', in: 'query', required: true, description: 'Longitude coordinate', type: 'number' },
          { name: 'units', in: 'query', required: false, description: 'Temperature units (metric or imperial)', type: 'string' },
        ],
        requestBody: null,
        responses: { '200': 'Current weather data', '400': 'Invalid coordinates' },
      },
      {
        method: 'GET',
        path: '/forecast/{days}',
        operationId: 'getForecast',
        summary: 'Get weather forecast for the next N days',
        description: 'Returns daily forecast data',
        parameters: [
          { name: 'days', in: 'path', required: true, description: 'Number of forecast days (1-14)', type: 'number' },
          { name: 'lat', in: 'query', required: true, description: 'Latitude coordinate', type: 'number' },
          { name: 'lon', in: 'query', required: true, description: 'Longitude coordinate', type: 'number' },
        ],
        requestBody: null,
        responses: { '200': 'Forecast data', '400': 'Invalid parameters' },
      },
      {
        method: 'GET',
        path: '/alerts',
        operationId: 'getWeatherAlerts',
        summary: 'Get active severe weather alerts for a region',
        description: 'Returns active weather warnings and advisories',
        parameters: [
          { name: 'region', in: 'query', required: true, description: 'Region code (e.g. US-CA)', type: 'string' },
        ],
        requestBody: null,
        responses: { '200': 'Active alerts', '404': 'No alerts found' },
      },
    ],
    groups: { current: [], forecast: [], alerts: [] },
    warnings: [],
  },
  expected: {
    minTools: 3,
    maxTools: 4,
    requiredPaths: ['/current', '/forecast/{days}', '/alerts'],
    expectedAuth: 'apiKey',
    expectedBaseUrl: 'https://api.weather.example.com/v2',
  },
}

export const ALL_FIXTURES: EvalFixture[] = [tasksCrud, weatherReadonly]
