import {localStorageMock} from './mocks'

beforeAll(() => {
  window.localStorage = localStorageMock()
})
beforeEach(() => {
  jest.clearAllMocks()
  window.localStorage.clear()
})
