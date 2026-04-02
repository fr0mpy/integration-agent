import type { DiscoveryResult } from '../../lib/pipeline/discover'

export const notionFixture: DiscoveryResult = {
  apiName: 'Notion API',
  apiDescription: 'Create, read, and update pages, databases, and blocks in Notion workspaces.',
  baseUrl: 'https://api.notion.com/v1',
  authMethod: 'bearer',
  authHeader: 'Authorization',
  endpointCount: 8,
  endpoints: [
    {
      method: 'GET',
      path: '/pages/{page_id}',
      operationId: 'getPage',
      summary: 'Retrieve a page',
      description: 'Retrieves a Notion page object including its properties.',
      parameters: [
        { name: 'page_id', in: 'path', required: true, description: 'The unique identifier of the page', type: 'string' },
      ],
      requestBody: null,
      responses: { '200': 'Page object' },
    },
    {
      method: 'POST',
      path: '/pages',
      operationId: 'createPage',
      summary: 'Create a page',
      description: 'Creates a new page inside a parent database or as a child of another page.',
      parameters: [],
      requestBody: {
        required: true,
        contentType: 'application/json',
        description: 'Page content and parent',
        schema: {
          type: 'object',
          properties: {
            parent: { type: 'object', description: 'Parent database or page reference with type and id', nullable: false, items: null, properties: null },
            properties: { type: 'object', description: 'Page property values matching the parent database schema', nullable: false, items: null, properties: null },
          },
          required: ['parent', 'properties'],
        },
      },
      responses: { '200': 'Created page' },
    },
    {
      method: 'PATCH',
      path: '/pages/{page_id}',
      operationId: 'updatePage',
      summary: 'Update page properties',
      description: 'Updates the properties of a page. Can also archive (soft-delete) a page.',
      parameters: [
        { name: 'page_id', in: 'path', required: true, description: 'The unique identifier of the page', type: 'string' },
      ],
      requestBody: {
        required: true,
        contentType: 'application/json',
        description: 'Properties to update',
        schema: {
          type: 'object',
          properties: {
            properties: { type: 'object', description: 'Updated property values', nullable: false, items: null, properties: null },
            archived: { type: 'boolean', description: 'Set to true to archive (soft-delete) the page', nullable: false, items: null, properties: null },
          },
          required: [],
        },
      },
      responses: { '200': 'Updated page' },
    },
    {
      method: 'POST',
      path: '/databases/{database_id}/query',
      operationId: 'queryDatabase',
      summary: 'Query a database',
      description: 'Gets a list of pages from a database, optionally filtered and sorted.',
      parameters: [
        { name: 'database_id', in: 'path', required: true, description: 'The unique identifier of the database', type: 'string' },
      ],
      requestBody: {
        required: false,
        contentType: 'application/json',
        description: 'Filter and sort criteria',
        schema: {
          type: 'object',
          properties: {
            filter: { type: 'object', description: 'Filter conditions to apply to database rows', nullable: false, items: null, properties: null },
            sorts: { type: 'array', description: 'Sort criteria as array of property/direction objects', nullable: false, items: null, properties: null },
            page_size: { type: 'integer', description: 'Number of results per page (max 100)', nullable: false, items: null, properties: null },
          },
          required: [],
        },
      },
      responses: { '200': 'Paginated list of pages' },
    },
    {
      method: 'GET',
      path: '/databases/{database_id}',
      operationId: 'getDatabase',
      summary: 'Retrieve a database',
      description: 'Retrieves a database object including its schema (property definitions).',
      parameters: [
        { name: 'database_id', in: 'path', required: true, description: 'The unique identifier of the database', type: 'string' },
      ],
      requestBody: null,
      responses: { '200': 'Database object' },
    },
    {
      method: 'GET',
      path: '/blocks/{block_id}/children',
      operationId: 'listBlockChildren',
      summary: 'Retrieve block children',
      description: 'Returns a paginated list of child blocks for the specified parent block or page.',
      parameters: [
        { name: 'block_id', in: 'path', required: true, description: 'The unique identifier of the block or page', type: 'string' },
        { name: 'page_size', in: 'query', required: false, description: 'Number of blocks to return (max 100)', type: 'integer' },
      ],
      requestBody: null,
      responses: { '200': 'List of child blocks' },
    },
    {
      method: 'PATCH',
      path: '/blocks/{block_id}',
      operationId: 'updateBlock',
      summary: 'Update a block',
      description: 'Updates the content of an existing block. Can also archive (delete) a block.',
      parameters: [
        { name: 'block_id', in: 'path', required: true, description: 'The unique identifier of the block', type: 'string' },
      ],
      requestBody: {
        required: true,
        contentType: 'application/json',
        description: 'Block content to update',
        schema: {
          type: 'object',
          properties: {
            archived: { type: 'boolean', description: 'Set to true to delete the block', nullable: false, items: null, properties: null },
          },
          required: [],
        },
      },
      responses: { '200': 'Updated block' },
    },
    {
      method: 'POST',
      path: '/search',
      operationId: 'search',
      summary: 'Search',
      description: 'Searches pages and databases accessible by the integration, by title.',
      parameters: [],
      requestBody: {
        required: false,
        contentType: 'application/json',
        description: 'Search parameters',
        schema: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Text to search for in page and database titles', nullable: false, items: null, properties: null },
            filter: { type: 'object', description: 'Filter to limit results to pages or databases only', nullable: false, items: null, properties: null },
            page_size: { type: 'integer', description: 'Number of results per page (max 100)', nullable: false, items: null, properties: null },
          },
          required: [],
        },
      },
      responses: { '200': 'Search results' },
    },
  ],
  groups: {
    pages: [],
    databases: [],
    blocks: [],
    search: [],
  },
  warnings: [],
}
