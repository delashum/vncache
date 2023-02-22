import {
  BasicResource,
  CacheConfig,
  InternalObjectCache,
  InternalRequestWatcherFn,
  InternalResourceCache,
  ObjectCache,
  RequestWatcherActions,
} from './types'
import {arraysIntersect, DEFAULT_TIMEOUT, ensureArray, getLocalMethods, hashBody, now} from './utilities'

/**
 * creates a an object store around a single resource type.
 * one store can have many queries which are differentiated by the queryBody used
 * object stores are 1:1 with resources stores and they share quite a bit of data
 *
 * @param resourceName name of the resource
 * @param resources reference to a map of all the resources
 * @param config options that can be configured on each store instance
 * @param resourceMethods resourceStore methods that objectStore needs access to
 * @param watchRequest callback for whenever an object is updated
 * @returns
 */
export const createObjectStore = <T extends BasicResource>(
  resourceName: string,
  resourceStore: InternalResourceCache<T>,
  config: CacheConfig,
  watch?: InternalRequestWatcherFn<T>
): InternalObjectCache<T> => {
  const symbol = '__object-cache-resource-ref__'
  const objectStore = new Map<string, ObjectCache>()
  const {getFromLocal, getLocalExpirationKey, getLocalKey, setToLocal} = getLocalMethods(resourceName)

  const defaultedConfig: CacheConfig = {timeout: DEFAULT_TIMEOUT, local: null, ...config}

  const createResourcePlaceholder = (id: string) => ({symbol, id})

  const buildObjectData = (data: any): any => {
    if (data == null) return data
    if (Array.isArray(data)) return data.map(buildObjectData)
    if (typeof data === 'object') {
      if (data.symbol === symbol) return resourceStore.getById(data.id)
      else return Object.keys(data).reduce((newObj, key) => ({...newObj, [key]: buildObjectData(data[key])}), {})
    }
    return data
  }

  const getRequestKeysFromIds = (ids: string[]) => {
    const keys: string[] = []
    for (const [key, entry] of objectStore) {
      if (!entry.ids || entry.ids.length === 0) continue
      if (arraysIntersect(ids, entry.ids)) keys.push(key)
    }
    return keys
  }

  const getDataByKey = (key: string) => {
    const entry = objectStore.get(key)
    return entry.ids.length > 0 ? buildObjectData(entry.data) : entry.data
  }

  const updateSubscribersByResourceIds = (ids: string | string[]) => {
    ids = ensureArray(ids)
    const updatedRequests = getRequestKeysFromIds(ids)
    updateObjectSubscribers(updatedRequests)
  }

  const updateObjectSubscribers = (keys: string | string[]) => {
    keys = ensureArray(keys)
    for (const key of keys) {
      const entry = objectStore.get(key)
      const newData = getDataByKey(key)
      if (defaultedConfig.local && entry.initialized) setToLocal(getLocalKey(key), entry.data)
      for (const fn of entry.subscribers) fn(newData)
    }
  }

  const getObjectFromLocal = (key: string): any => {
    const data = getFromLocal<any>(getLocalKey(key))
    const expiration = getFromLocal<number>(getLocalExpirationKey(key))
    if (!data || expiration == null) return null
    if (expiration < now()) {
      setToLocal(getLocalKey(key), null)
      setToLocal(getLocalExpirationKey(key), null)
      return null
    }
    return buildObjectData(data)
  }

  const requestObjectData = async (key: string) => {
    const entry = objectStore.get(key)
    const ids = new Set<string>()
    const registerResource = (resource: T) => {
      const resourceId = resource?.id
      if (!resourceId) return resource
      ids.add(resourceId)
      resourceStore.upsert(resource)
      updateSubscribersByResourceIds(resourceId)
      return createResourcePlaceholder(resourceId)
    }

    try {
      const res = await entry.fn(entry.body, registerResource)
      entry.data = res
      entry.fromLocal = false
      entry.ids = [...ids]
      entry.initialized = true
      entry.resolver = null
      entry.subscriberCleanup = resourceStore.subscribeIds([...ids], () => {
        updateObjectSubscribers(key)
      })
      updateObjectSubscribers(key)
    } catch (err: any) {
      entry.error = err
      entry.resolver = null
      entry.initialized = true
      // TODO how to rethrow this?
    }
  }

  const createObjectResolver = async (key: string) => {
    const entry = objectStore.get(key)

    const localData = getObjectFromLocal(key)

    if (defaultedConfig.local && localData != null) {
      entry.fromLocal = true
      entry.initialized = true
      entry.resolver = null
      entry.data = localData
      if (defaultedConfig.local.strategy === 'soft') requestObjectData(key)
    } else entry.resolver = requestObjectData(key)
  }

  const ensureObjectFetched = (key: string) => {
    const entry = objectStore.get(key)
    if (!entry.initialized && !entry.resolver) createObjectResolver(key)
  }

  const cleanupObjectStore = (key: string) => {
    const entry = objectStore.get(key)
    entry.initialized = false
    entry.ids = []
    entry.cleanup?.()
    entry.subscriberCleanup?.()
    entry.cleanup = null
  }

  const getAllActiveObjectKeys = () => {
    const keys: string[] = []
    for (const [key, entry] of objectStore) if (entry.initialized) keys.push(key)
    return keys
  }

  const createRequestWatcherActionsClosure = (key: string): RequestWatcherActions<T> => ({
    upsert: items => {
      resourceStore.upsert(items as any)
      updateSubscribersByResourceIds(ensureArray(items).map(r => r.id))
    },
    remove: ids => {
      resourceStore.remove(ids)
      updateSubscribersByResourceIds(ids)
    },
    patch: (update, which) => {
      for (const [_key, entry] of objectStore.entries()) {
        if (entry.key === key) {
          if (!which || which(entry.body)) {
            entry.data = {...entry.data, ...update}
            updateObjectSubscribers(_key)
          }
        }
      }
    },
  })

  const activateObjectStore = (key: string) => {
    const entry = objectStore.get(key)
    if (entry.initialized === false) return
    if (watch) entry.cleanup = watch(entry.body, createRequestWatcherActionsClosure(entry.key))
  }

  return {
    register: (_key, body, fn) => {
      const key = [_key, hashBody(body)].join('_')
      if (objectStore.has(key)) return key
      objectStore.set(key, {
        data: null,
        ids: [],
        initialized: false,
        subscribers: new Set(),
        resolver: null,
        fn,
        body,
        key: _key,
        error: null,
        fromLocal: false,
        activeTimer: null,
      })
      return key
    },
    resolve: async (key, activateCache = false) => {
      ensureObjectFetched(key)
      const entry = objectStore.get(key)
      if (entry.resolver) await entry.resolver
      if (activateCache) {
        clearTimeout(entry.activeTimer)
        activateObjectStore(key)
        entry.activeTimer = setTimeout(() => {
          if (entry.subscribers.size === 0) cleanupObjectStore(key)
        }, defaultedConfig.timeout)
      }
      return getDataByKey(key)
    },
    isResolving: key => {
      ensureObjectFetched(key)
      return objectStore.has(key) && objectStore.get(key).resolver != null
    },
    get: key => {
      ensureObjectFetched(key)
      return getDataByKey(key)
    },
    subscribe: (key, fn) => {
      const entry = objectStore.get(key)
      if (entry.subscribers.size === 0) activateObjectStore(key)
      entry.subscribers.add(fn)
      clearTimeout(entry.activeTimer)
      return () => {
        entry.activeTimer = setTimeout(() => {
          entry.subscribers.delete(fn)
          if (entry.subscribers.size === 0) cleanupObjectStore(key)
        }, defaultedConfig.timeout)
      }
    },
    cleanup: () => {
      if (defaultedConfig.local) {
        for (const key of getAllActiveObjectKeys())
          setToLocal(getLocalExpirationKey(key), now() + defaultedConfig.local.inactiveTimeout)
      }
    },
  }
}
