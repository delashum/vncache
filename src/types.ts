export type UnArray<T> = T extends Array<infer K> ? K : T
type AtLeast<T, K extends keyof T> = Partial<T> & Pick<T, K>

export type ExtractTypesFromResource<T extends ResourceInstance> = {
  ResourceType: T extends ResourceInstance<infer X> ? X : never
  QueryBody: T extends ResourceInstance<any, infer X> ? X : never
  EventMap: T extends ResourceInstance<any, any, infer X> ? X : never
  ActionTypes: T extends ResourceInstance<any, any, any, infer X> ? X : never
  CacheTypes: T extends ResourceInstance<any, any, any, any, infer X> ? X : never
}

export type ExtractTypeFromCache<T extends ResourceCacheInstance<any>> = T extends ResourceCacheInstance<any, infer X>
  ? X
  : never

export type DesuffixKey<T extends string> = T extends `${infer K}_ids`
  ? `${K}s`
  : T extends `${infer K}_id`
  ? K
  : `nested_${T}`

// OTHER

export type BasicResource = {
  id: string
  [key: string]: any
}

export type ResourceCallbackArg<Q = any> = {
  query?: Q
  ids?: string[]
}

export type CacheEventDelete = {
  type: 'delete'
  ids: string[]
}

export type CacheEventInsert = {
  type: 'insert'
  resources: any[]
}

export type CacheEvent<T = {}> = T & {
  name: string
  action?: CacheEventDelete | CacheEventInsert
}

export type ResourceResponseMeta = {error?: any; loading?: boolean; fromLocal?: boolean}

type ResourceResponse<T> = T[] & ResourceResponseMeta

export type UseConfig = {
  suspend: boolean
  throwError: boolean
  enabled: boolean
}

export type CacheInstanceMethods = {
  batch: <R extends Pick<ResourceCacheInstance<any, any>, 'use' | 'resolve' | 'preload'>[]>(
    ...fns: R
  ) => {
    use: (config?: Partial<UseConfig>) => {[index in keyof R]: ReturnType<R[index]['use']>}
    resolve: () => Promise<{[index in keyof R]: ReturnType<R[index]['use']>}>
  }
  publish: (ev: any | any[], debounce: boolean) => void
}

export type InternalResourceInstance<T extends BasicResource, QB = any> = {
  fn: (arg: ResourceCallbackArg) => Promise<T[]>
  actions: Record<string, (body: any, utils: ActionActions<T, QB>) => Promise<any>>
  requests: Record<string, (body: any, register: <S extends T | T[]>(resource: S) => S) => Promise<any>>
  subscribers: {eventName: string; fn: CacheWatcherFn<T>}[]
  requestSubscribers: {key: string; eventName: string; fn: RequestWatcherFn<T>}[]
  store: {
    resource: InternalResourceCache<T>
    object: InternalObjectCache<T>
  }
  persistLocalConfig: LocalPersistenceConfig
  sanitizeQuery: (body: ResourceCallbackArg) => ResourceCallbackArg
  __processEvents: (evs: CacheEvent[]) => void
}

export type WatcherActions<T extends BasicResource> = {
  reload: () => void
  upsert: (items: AtLeast<T, 'id'> | AtLeast<T, 'id'>[]) => void
  remove: (ids: string | string[]) => void
}

export type ActionActions<T extends BasicResource, Q> = {
  reload: (which?: (body: ResourceCallbackArg<Q>) => boolean) => void
  remove: (ids: string | string[]) => void
  upsert: (items: AtLeast<T, 'id'> | AtLeast<T, 'id'>[]) => void
  updateAllResources: (updateFn: Partial<T> | ((resource: T) => Partial<T>)) => void
}

export type RequestWatcherActions<T extends BasicResource, CB = any, CR = any> = {
  remove: (ids: string | string[]) => void
  patch: (update: Partial<CR>, which?: (body: CB) => boolean) => void
  upsert: (items: AtLeast<T, 'id'> | AtLeast<T, 'id'>[]) => void
}

export type CacheWatcherFn<T extends BasicResource = any, Q = any, EV = any> = (
  body: ResourceCallbackArg<Q>,
  ev: CacheEvent<EV>,
  actions: WatcherActions<T>
) => void | (() => void)

export type RequestWatcherFn<T extends BasicResource = any, B = any, EV = any, CR = any> = (
  body: B,
  ev: CacheEvent<EV>,
  actions: RequestWatcherActions<T, B, CR>
) => void | (() => void)

export type InternalCacheWatcherFn<T extends BasicResource = any> = (
  body: ResourceCallbackArg<any>,
  actions: WatcherActions<T>
) => () => void

export type InternalRequestWatcherFn<T extends BasicResource = any> = (
  body: any,
  actions: RequestWatcherActions<T>
) => () => void

export type InternalObjectCache<T> = {
  get: (key: string) => T
  isResolving: (key: string) => boolean
  resolve: (key: string, activateCache?: boolean) => Promise<T>
  register: (
    key: string,
    body: any,
    resolver: (body: any, registerResource: (data: any) => any) => Promise<T>
  ) => string
  subscribe: (key: string, fn: (data: T) => void) => () => void
  cleanup: () => void
}

export type InternalResourceCache<T> = {
  get: (key: string) => ResourceResponse<T>
  getById: (id: string) => T
  isResolving: (key: string) => boolean
  resolve: (key: string, activateCache?: boolean) => Promise<T[]>
  register: (
    originalBody: ResourceCallbackArg,
    sanitizedBody: ResourceCallbackArg,
    resolver: (body: ResourceCallbackArg) => Promise<T[]>
  ) => string
  subscribe: (key: string, fn: (items: T[]) => void) => () => void

  remove: (ids: string | string[]) => void
  upsert: (items: T | T[]) => void
  reload: (key: string) => void

  getAllActiveCaches: () => {key: string; body: any}[]
  getAllResources: () => T[]
  cleanup: () => void
}

export type LocalPersistenceConfig = {
  strategy: 'hard' | 'soft'
  inactiveTimeout: number
}

export type ResourceInstance<
  R extends BasicResource = any,
  QB = any,
  EM = any,
  Actions extends Record<string, [any, any]> = {},
  Caches extends Record<string, [any, any]> = {}
> = {
  action: <ActionKey extends string, ActionBody, ActionResponse>(
    key: ActionKey,
    fn: (body: ActionBody, utils: ActionActions<R, QB>) => Promise<ActionResponse>
  ) => ResourceInstance<R, QB, EM, Actions & {[key in ActionKey]: [ActionBody, ActionResponse]}, Caches>
  request: <CacheKey extends string, CacheResponse, K extends Extract<keyof EM, string>, CacheBody = {}>(
    key: CacheKey,
    fn: (body: CacheBody, registerResource: <T extends R | R[]>(resource: T) => T) => Promise<CacheResponse>,
    watchers?: [K, RequestWatcherFn<R, CacheBody, EM[K], CacheResponse>][]
  ) => ResourceInstance<R, QB, EM, Actions, Caches & {[key in CacheKey]: [CacheBody, CacheResponse]}>
  watch: <K extends Extract<keyof EM, string>>(
    eventName: K,
    fn?: CacheWatcherFn<R, QB, EM[K]>
  ) => ResourceInstance<R, QB, EM, Actions, Caches>
  sanitizeQuery: (
    fn?: (body: ResourceCallbackArg<QB>) => ResourceCallbackArg<QB>
  ) => ResourceInstance<R, QB, EM, Actions, Caches>
  persistLocal: (config?: Partial<LocalPersistenceConfig>) => ResourceInstance<R, QB, EM, Actions, Caches>
  __compile: (key: string, cacheTimeout: number) => InternalResourceInstance<R, QB>
}

export type ResourceCacheInstance<
  T extends ExtractTypesFromResource<any>,
  ResponseType = ResourceResponse<T['ResourceType']>
> = {
  query: (body: T['QueryBody']) => Omit<ResourceCacheInstance<T, ResponseType>, 'ids' | 'fetch' | 'query' | 'do'>
  ids: (...ids: string[]) => Omit<ResourceCacheInstance<T, ResponseType>, 'query' | 'fetch' | 'ids' | 'do'>
  nest: <Key extends Extract<keyof UnArray<ResponseType>, string>, C extends ResourceCacheInstance<any, any>>(
    key: Key,
    resource: C
  ) => Omit<
    ResourceCacheInstance<
      T,
      (UnArray<ResponseType> & {
        [K in DesuffixKey<Key>]: UnArray<ResponseType>[Key] extends Array<any>
          ? UnArray<ExtractTypeFromCache<C>>[]
          : UnArray<ExtractTypeFromCache<C>>
      })[]
    >,
    'fetch' | 'do'
  >
  fetch: <Key extends Extract<keyof T['CacheTypes'], string>>(
    key: Key,
    body: T['CacheTypes'][Key][0] | void
  ) => Omit<ResourceCacheInstance<T, T['CacheTypes'][Key][1]>, 'ids' | 'query' | 'fetch' | 'do' | 'nest'>
  use: (config?: Partial<UseConfig>) => ResponseType
  resolve: () => Promise<ResponseType>
  preload: () => void
  do: <Key extends Extract<keyof T['ActionTypes'], string>>(
    key: Key,
    body: T['ActionTypes'][Key][0]
  ) => Promise<T['ActionTypes'][Key][1]>
}

export type InternalResourceCacheData = {
  __context: Readonly<CommandContext>
  __resourceName: Readonly<string>
  __isResolving: Readonly<boolean>
  __snapshot: Readonly<any[]>
}

export type CommandContext<T = any> = {
  type: 'fetch' | 'resource'
  cacheKey: string
  body: T
  nest: {key: string; resource: ResourceCacheInstance<any, any>}[]
}

export type ResourceContext = {
  batch: boolean
}

export type ResourceCacheOptions = {
  cacheTimeout?: number
  eventDebounce?: number
}

type CacheEntry = {
  ids: string[]
  initialized: boolean
  subbers: Set<(data: any) => void>
  resolver: Promise<any> | null
  activeTimer: NodeJS.Timeout
  error: any
  fromLocal: boolean
  cleanup?: () => void
}

export type ResourceCache<T> = CacheEntry & {
  key: string
  body: ResourceCallbackArg
  refKey: string // this points to the cache key that houses the actual data if they are merged due to sanitizeQuery
  fn: (body: ResourceCallbackArg) => Promise<T[]>
}

export type ObjectCache = CacheEntry & {
  body: any
  data: any
  key: string
  fn: (body: any, register: (data: any) => any) => Promise<any>
}

export type CacheConfig = {
  timeout: number
  local: LocalPersistenceConfig
}
