import type { GoldenExpectation } from '../types'

export const petstoreGolden: GoldenExpectation = {
  requiredTools: ['list_pets', 'get_pet', 'create_pet', 'delete_pet'],
  forbiddenTools: ['admin_settings', 'get_store_config', 'internal_healthcheck', 'drop_database'],
  expectedMappings: {
    list_pets: { httpMethod: 'GET', httpPath: '/pets' },
    get_pet: { httpMethod: 'GET', httpPath: '/pets/{petId}' },
    create_pet: { httpMethod: 'POST', httpPath: '/pets' },
    delete_pet: { httpMethod: 'DELETE', httpPath: '/pets/{petId}' },
  },
  minTools: 4,
  maxTools: 8,
  authMethod: 'apiKey',
  composedTools: [],
}
