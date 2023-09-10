const isDefined = (value: any) => value != null

export const distinct = <T>(values: T[]) => {
  const set = new Set(values)
  return Array.from(set)
}
export const concrete = <T>(values: T[]) => {
  return values.filter(isDefined)
}

export const IDENTITY_FN = <T>(e: T) => e

export const DEFAULT_TIMEOUT = 5000 // 5 seconds
export const RESOURCE_SYMBOL = Symbol('[vnrcache-resource]')
export const ACTION_SYMBOL = Symbol('[vnrcache-action]')

export const hashBody = (body: any) => JSON.stringify(body)
export const dehashBody = (key: string) => JSON.parse(key)

export const arraysIntersect = (a: string[], b: string[]) => distinct([...a, ...b]).length !== a.length + b.length

export const now = () => +new Date()

export const getLocalMethods = (name: string) => {
  const LOCALSTORAGE_KEY = 'RESOURCES'
  const getLocalKey = (key?: string, key2?: string) =>
    ['VNRCACHE', name, key ?? LOCALSTORAGE_KEY, key2].filter(isDefined).join('-')
  const getLocalExpirationKey = (key?: string, key2?: string) =>
    ['VNRCACHE', name, key ?? LOCALSTORAGE_KEY, key2, 'expiration'].filter(isDefined).join('-')

  const getFromLocal = <T = any>(key: string): T => {
    const fromStorage = localStorage.getItem(key)
    if (fromStorage === 'undefined') return undefined
    if (fromStorage === null) return null
    return JSON.parse(fromStorage)
  }
  const setToLocal = (key: string, value: any) => {
    localStorage.setItem(key, JSON.stringify(value))
  }

  return {getFromLocal, setToLocal, getLocalKey, getLocalExpirationKey, KEY: LOCALSTORAGE_KEY}
}

export const ensureArray = <T>(data: T | T[] = []): T[] => (Array.isArray(data) ? data : data ? [data] : [])

export const arrayToMap = <T = any>(arr: T[], key: string): Record<string, T> => {
  const map: Record<string, T> = {}
  for (let i = 0; i < arr.length; i++) {
    const item: any = arr[i]
    const keyValue = item[key]
    map[keyValue] = item
  }
  return map
}
