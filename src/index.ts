import {createObjectStore} from './object-store'
import {createRequestClosure} from './request-builder'
import {createResourceStore} from './resource-store'
import {
  BasicResource,
  CacheEvent,
  CacheInstanceMethods,
  ExtractTypesFromResource,
  InternalResourceInstance,
  LocalPersistenceConfig,
  RequestWatcherActions,
  ResourceCacheInstance,
  ResourceCacheOptions,
  ResourceCallbackArg,
  ResourceInstance,
  WatcherActions,
} from './types'
import {ensureArray, IDENTITY_FN} from './utilities'

export const resource = <
  ResourceType extends BasicResource,
  QueryBody = void,
  EventMap extends Record<string, any> = Record<string, any>
>(
  fn?: (arg: ResourceCallbackArg<QueryBody>) => Promise<ResourceType[]>
) => {
  const actions: InternalResourceInstance<ResourceType>['actions'] = {}
  const requests: InternalResourceInstance<ResourceType>['requests'] = {}
  const subscribers: InternalResourceInstance<ResourceType>['subscribers'] = []
  const requestSubscribers: InternalResourceInstance<ResourceType>['requestSubscribers'] = []
  const activeResourceCaches = new Map<ResourceCallbackArg, WatcherActions<ResourceType>>()
  const activeObjectCaches = new Map<any, RequestWatcherActions<ResourceType>>()
  let sanitizeQuery = (e: any) => e
  let persistLocalConfig: LocalPersistenceConfig = null

  const obj: ResourceInstance<ResourceType, QueryBody, EventMap> = {
    action: (key, fn) => {
      if (key in actions) throw Error(`A resource cannot have multiple actions with the same name: '${key}'`)
      actions[key] = fn
      return obj
    },
    request: (key, fn, watchers) => {
      if (key in requests) throw Error(`A resource cannot have multiple requests with the same name: '${key}'`)
      requests[key] = fn
      if (watchers) for (const [eventName, fn] of watchers) requestSubscribers.push({key, eventName, fn})
      return obj
    },
    watch: (eventName, fn) => {
      subscribers.push({eventName, fn})
      return obj
    },
    sanitizeQuery: fn => {
      sanitizeQuery = fn ?? (() => ({}))
      return obj
    },
    persistLocal: (config = {}) => {
      persistLocalConfig = {
        inactiveTimeout: 1000 * 60 * 60 * 24 * 7, // 7 days is default
        strategy: 'hard',
        ...config,
      }
      return obj
    },
    // this method is used internally to bundle up all of the configuration that were defined on a resource
    // is is guaranteed to only be called once when the resource cache is first created
    __compile: (key, cacheTimeout) => {
      const resourceStore = createResourceStore<ResourceType>(
        key,
        {local: persistLocalConfig, timeout: cacheTimeout},
        (body, actions) => {
          activeResourceCaches.set(body, actions)
          return () => activeResourceCaches.delete(body)
        }
      )

      const objectStore = createObjectStore<ResourceType>(
        key,
        resourceStore,
        {local: persistLocalConfig, timeout: cacheTimeout},
        (body, actions) => {
          activeObjectCaches.set(body, actions)
          return () => activeObjectCaches.delete(body)
        }
      )

      // cleanup local stores if page closes
      window.addEventListener('beforeunload', () => {
        resourceStore.cleanup()
        objectStore.cleanup()
      })

      return {
        fn,
        actions,
        requests,
        sanitizeQuery,
        subscribers,
        requestSubscribers,
        store: {
          resource: resourceStore,
          object: objectStore,
        },
        persistLocalConfig,
        __processEvents: evs => {
          for (const [body, actions] of activeResourceCaches)
            for (const {eventName, fn} of subscribers)
              for (const ev of evs) if (ev.name === eventName) fn?.(body, ev, actions)
          for (const [body, actions] of activeObjectCaches)
            for (const {eventName, fn} of requestSubscribers)
              for (const ev of evs) if (ev.name === eventName) fn?.(body, ev, actions)
        },
      }
    },
  }
  return obj as ResourceInstance<ResourceType, QueryBody, EventMap>
}

export const createResourceCache = <ResourceCache extends Record<string, ResourceInstance>>(
  resources: ResourceCache,
  options?: ResourceCacheOptions,
  transformEvent: (ev: any) => CacheEvent<any> = IDENTITY_FN
): {
  [K in keyof ResourceCache]: ResourceCacheInstance<ExtractTypesFromResource<ResourceCache[K]>>
} & CacheInstanceMethods => {
  options = {cacheTimeout: 500, eventDebounce: 100, ...options}
  const resourceInstances = new Map<string, InternalResourceInstance<any>>()
  for (const key in resources) {
    resourceInstances.set(key, resources[key].__compile(key, options.cacheTimeout))
  }

  let debounceTimer: NodeJS.Timer
  const debouncedEventBus = new Set<CacheEvent>()

  const queueEvents = (events: CacheEvent[]) => {
    clearTimeout(debounceTimer)
    for (const ev of events) debouncedEventBus.add(ev)
    debounceTimer = setTimeout(() => {
      processEvents([...debouncedEventBus])
      debouncedEventBus.clear()
    })
  }

  const processEvents = (events: CacheEvent[]) => {
    for (const [key, instance] of resourceInstances) instance.__processEvents(events)
  }

  const instanceMethods: CacheInstanceMethods = {
    batch: (...requests) => ({
      use: (config): any => {
        for (const req of requests) req.preload()
        return requests.map(req => req.use(config))
      },
      resolve: (): Promise<any> => {
        return Promise.all(requests.map(e => e.resolve()))
      },
    }),
    publish: (events, debounce) => {
      const eventArray = ensureArray(events)
      const mappedEvents = eventArray.map(transformEvent)
      if (debounce) queueEvents(mappedEvents)
      else processEvents(mappedEvents)
    },
  }

  const cacheResource = new Proxy(instanceMethods, {
    get: (methods, key: Extract<keyof ResourceCache, string> | keyof CacheInstanceMethods) => {
      if (key in methods) return methods[key as keyof CacheInstanceMethods]
      if (!(key in resources)) throw Error(`That resource doesn't exist in this cache: '${key}'`)
      return createRequestClosure(key, resourceInstances.get(key), options)
    },
  })

  return cacheResource as any
}

export {type ResourceInstance, type ResourceCacheInstance} from './types'

/**
 * things to do still
 * 1. using resource (maybe fetch too) data within an action
 *    on orgs/update we need orgs/me to get the org
 *    statuses
 * 2. resourceless fetching
 *    one reason is to make organizing things easier
 * 3. updating a request (without refetching)
 * 4. reordering resources
 * 5. the way watching works kinda sucks (this is from me)
 * 6. when we reload we need to know how to ignore events older than a certain time
 *    maybe we allow custom event filtering
 */
