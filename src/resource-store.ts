import {
  BasicResource,
  CacheConfig,
  InternalCacheWatcherFn,
  InternalResourceCache,
  ResourceCache,
  ResourceResponseMeta,
  WatcherActions,
} from './types'
import {arraysIntersect, DEFAULT_TIMEOUT, distinct, ensureArray, getLocalMethods, hashBody, now} from './utilities'

/**
 * creates a resource and object store around a single resource type.
 * one store can have many queries which are differentiated by the queryBody used
 *
 * @param resourceName name of the resource we are creating the store for e.g. 'users' or 'accounts'
 * @param config options that can be configured on each store instance
 * @param watch callback for whenever a resource is updated
 * @param watchRequest callback for whenever an object is updated
 * @returns a resource and object store instance
 */
export const createResourceStore = <T extends BasicResource>(
  resourceName: string,
  config: Partial<CacheConfig>,
  watch?: InternalCacheWatcherFn<T>
): InternalResourceCache<T> => {
  const {getFromLocal, getLocalExpirationKey, getLocalKey, setToLocal} = getLocalMethods(resourceName)

  const defaultedConfig: CacheConfig = {timeout: DEFAULT_TIMEOUT, local: null, ...config}

  const buildResourceStore = (): Map<string, T> => {
    if (defaultedConfig.local) {
      const resourceEntries = getFromLocal(getLocalKey())
      if (resourceEntries != null) {
        const resourceExpireOn: number = getFromLocal(getLocalExpirationKey())
        if (resourceExpireOn > now()) return new Map(resourceEntries)
        else {
          setToLocal(getLocalKey(), null)
          setToLocal(getLocalExpirationKey(), null)
        }
      }
    }
    return new Map()
  }

  const resources = buildResourceStore()
  const resourceStore = new Map<string, ResourceCache<T>>()

  const getResourceStore = (key: string): ResourceCache<T> => {
    if (!resourceStore.has(key)) return null
    const entry = resourceStore.get(key)
    if (!entry.refKey) return entry
    else {
      const _entry = getResourceStore(entry.refKey)
      return {..._entry, ids: entry.ids, subbers: entry.subbers}
    }
  }

  const setResourceStoreValues = (key: string, updates: Partial<ResourceCache<T>>): ResourceCache<T> => {
    if (!resourceStore.has(key)) return null
    const entry = resourceStore.get(key)
    if (entry.refKey) {
      const _entry = resourceStore.get(entry.refKey)
      const {ids, ..._updates} = updates
      if (ids) {
        if (!entry.body.ids) resourceStore.set(key, {...entry, ids})
        if (!_entry.body.ids) resourceStore.set(entry.refKey, {..._entry, ids})
      }
      resourceStore.set(entry.refKey, {..._entry, ..._updates})
    } else resourceStore.set(key, {...entry, ...updates})
  }

  const getChildrenKeys = (keys: string[]) => {
    const newKeys: string[] = []
    for (const [key, entry] of resourceStore) {
      if (keys.includes(entry.refKey)) newKeys.push(key)
    }
    return distinct([...keys, ...newKeys])
  }

  const updateSubscribers = (keys: string | string[]) => {
    const _keys = ensureArray(keys)
    const keyArr = getChildrenKeys(_keys)
    for (const key of keyArr) {
      const entry = getResourceStore(key)
      const newData = getResourceData(key)
      for (const fn of entry.subbers) fn(newData)
      if (defaultedConfig.local && entry.initialized) setToLocal(getLocalKey(key), entry.ids)
    }
    if (defaultedConfig.local) setToLocal(getLocalKey(), [...resources.entries()])
  }

  const getKeysFromIds = (ids: string[]) => {
    const keys: string[] = []
    for (const [key, entry] of resourceStore) {
      if (!entry.ids || entry.ids.length === 0) continue
      if (arraysIntersect(ids, entry.ids)) keys.push(key)
    }
    return keys
  }

  const getAllActiveKeys = () => {
    const keys: string[] = []
    for (const [key, entry] of resourceStore) if (entry.initialized) keys.push(key)
    return keys
  }

  const getResourcesFromLocal = (key: string): T[] => {
    const ids = getFromLocal<string[]>(getLocalKey(key))
    const expiration = getFromLocal<number>(getLocalExpirationKey(key))
    if (!ids || expiration == null) return null
    if (expiration < now()) {
      setToLocal(getLocalKey(key), null)
      setToLocal(getLocalExpirationKey(key), null)
      return null
    }
    return ids.map(id => resources.get(id))
  }

  const processResourceItems = (key: string, items: T[]) => {
    const ids = []
    for (const item of items) {
      ids.push(item.id)
      resources.set(item.id, item)
    }
    setResourceStoreValues(key, {ids, initialized: true, resolver: null})
    updateSubscribers(key)
  }

  const requestResources = async (key: string) => {
    const entry = getResourceStore(key)
    try {
      const res = await entry.fn(entry.body)
      processResourceItems(key, res)
      setResourceStoreValues(key, {fromLocal: false})
    } catch (err: any) {
      setResourceStoreValues(key, {error: err, resolver: null, initialized: true})
      // TODO how to rethrow this?
    }
  }

  const createResolver = async (key: string) => {
    const entry = getResourceStore(key)
    const localItems = getResourcesFromLocal(key)
    if (defaultedConfig.local && localItems != null) {
      processResourceItems(key, localItems)
      setResourceStoreValues(key, {fromLocal: true})
      if (defaultedConfig.local.strategy === 'soft') requestResources(key)
    } else {
      setResourceStoreValues(entry.key, {resolver: requestResources(entry.key)})
    }
  }

  const deleteIds = (ids: string | string[]) => {
    ids = ensureArray(ids)
    const cachesToUpdate = getKeysFromIds(ids)
    for (const cacheKey of cachesToUpdate) {
      const entry = getResourceStore(cacheKey)
      setResourceStoreValues(cacheKey, {ids: entry.ids.filter(id => !ids.includes(id))})
    }
    updateSubscribers(cachesToUpdate)
    for (const id of ids) resources.delete(id)
  }

  const upsertItems = (items: Partial<T> | Partial<T>[], key?: string) => {
    items = ensureArray(items)
    const ids = items.map(e => e.id)
    const allKeys = getAllActiveKeys()
    const keys = key ? [key] : allKeys
    let numNewItems = 0
    for (const item of items) {
      if (resources.has(item.id)) {
        resources.set(item.id, {...resources.get(item.id), ...item})
      } else {
        resources.set(item.id, item as T)
        for (const key of keys) {
          const entry = getResourceStore(key)
          setResourceStoreValues(key, {ids: distinct([...entry.ids, ...ids])})
        }
        numNewItems++
      }
    }
    const updatedCaches = getKeysFromIds(ids)
    const cachesToUpdate = key ? [key] : numNewItems === 0 ? updatedCaches : distinct([...updatedCaches, ...allKeys])
    updateSubscribers(cachesToUpdate)
  }

  const createActionsClosure = (key: string): WatcherActions<T> => ({
    reload: () => createResolver(key),
    upsert: items => upsertItems(items, key),
    remove: deleteIds,
  })

  const activateStore = (key: string) => {
    const entry = getResourceStore(key)
    if (entry.body.ids?.length === 0 || entry.initialized === false) return
    if (watch) setResourceStoreValues(key, {cleanup: watch(entry.body, createActionsClosure(key))})
  }

  const cleanupStore = (key: string) => {
    const entry = getResourceStore(key)
    const oldIds = entry.ids
    setResourceStoreValues(key, {initialized: false, ids: []})
    entry.cleanup?.()
    setResourceStoreValues(key, {cleanup: null})
    if (defaultedConfig.local) setToLocal(getLocalExpirationKey(key), now() + defaultedConfig.local.inactiveTimeout)

    const activeIds = new Set<string>()
    const passiveIds = new Set<string>()
    for (const [key, _entry] of resourceStore) {
      if (_entry.initialized) for (const id of _entry.ids) activeIds.add(id)
      if (!_entry.initialized && _entry.subbers.size > 0) for (const id of _entry.ids) passiveIds.add(id)
    }
    const idsToDelete = oldIds.filter(id => !activeIds.has(id))
    const actuallyDontDeleteThese = new Set<string>()
    for (const [key, _entry] of resourceStore)
      if (!_entry.initialized && _entry.subbers.size > 0 && idsToDelete.some(id => _entry.ids.includes(id))) {
        setResourceStoreValues(key, {initialized: true})
        for (const id of _entry.ids) actuallyDontDeleteThese.add(id)
      }

    for (const id of idsToDelete) if (!actuallyDontDeleteThese.has(id)) resources.delete(id)

    if (defaultedConfig.local) {
      setToLocal(getLocalKey(), [...resources.entries()])
      if (getAllActiveKeys().length === 0)
        setToLocal(getLocalExpirationKey(), now() + defaultedConfig.local.inactiveTimeout)
    }
  }

  const ensureResourceFetched = (key: string) => {
    const entry = getResourceStore(key)
    if (entry.ids.length > 0 && !entry.initialized) {
      const idResources = entry.ids.map(id => resources.get(id))
      const idsExistInCache = !idResources.includes(undefined)
      if (!idsExistInCache && !entry.resolver) createResolver(key)
    } else if (!entry.initialized && !entry.resolver) {
      createResolver(key)
    }
  }

  const getResourceData = (key: string) => {
    const meta: ResourceResponseMeta = {error: null, loading: false, fromLocal: false}
    let response: T[] = []
    const entry = getResourceStore(key)
    if (entry != null) {
      meta.error = entry.error
      meta.loading = !!entry.resolver
      meta.fromLocal = entry.fromLocal
      if (entry.ids) {
        const idResources = entry.ids.map(id => resources.get(id))
        const idsExistInCache = !idResources.includes(undefined)
        if (idsExistInCache) response = idResources
      } else meta.error = "[vnrcache-ERROR]: data wasn't initialized correctly."
    }

    Object.assign(response, meta)
    return response
  }

  const _registerResource: InternalResourceCache<T>['register'] = (originalBody, sanitizedBody, fn) => {
    const originalKey = hashBody(originalBody)
    const sanitizedKey = hashBody(sanitizedBody)
    if (resourceStore.has(originalKey)) return originalKey
    const refKey = originalKey !== sanitizedKey ? _registerResource(sanitizedBody, sanitizedBody, fn) : null
    const ids = originalBody.ids ?? []

    resourceStore.set(originalKey, {
      key: originalKey,
      ids,
      initialized: false,
      subbers: new Set(),
      resolver: null,
      refKey,
      fn,
      body: originalBody,
      error: null,
      fromLocal: false,
      activeTimer: null,
    })
    return originalKey
  }

  return {
    register: _registerResource,
    isResolving: key => {
      ensureResourceFetched(key)
      return resourceStore.has(key) && resourceStore.get(key).resolver != null
    },
    resolve: async (key, activateCache = false) => {
      ensureResourceFetched(key)
      const entry = getResourceStore(key)
      if (entry.resolver) await entry.resolver
      if (activateCache) {
        clearTimeout(entry.activeTimer)
        activateStore(key)
        setResourceStoreValues(key, {
          activeTimer: setTimeout(() => {
            if (entry.subbers.size === 0) cleanupStore(key)
          }, defaultedConfig.timeout),
        })
      }
      return getResourceData(key)
    },
    get: key => {
      ensureResourceFetched(key)
      return getResourceData(key)
    },

    getById: id => resources.get(id),

    subscribe: (key, fn) => {
      const entry = resourceStore.get(key)
      if (entry.subbers.size === 0) activateStore(key)
      entry.subbers.add(fn)
      clearTimeout(entry.activeTimer)
      return () => {
        entry.subbers.delete(fn)
        setResourceStoreValues(key, {
          activeTimer: setTimeout(() => {
            if (entry.subbers.size === 0) cleanupStore(key)
          }, defaultedConfig.timeout),
        })
      }
    },
    remove: deleteIds,
    upsert: upsertItems,
    reload: (key: string) => createResolver(key),

    getAllResources: () => Array.from(resources.values()),
    getAllActiveCaches: () => {
      const allKeys = getAllActiveKeys()
      return allKeys.map(key => ({key, body: resourceStore.get(key).body}))
    },
    cleanup: () => {
      if (defaultedConfig.local) {
        setToLocal(getLocalExpirationKey(), now() + defaultedConfig.local.inactiveTimeout)
        for (const key of getAllActiveKeys())
          setToLocal(getLocalExpirationKey(key), now() + defaultedConfig.local.inactiveTimeout)
      }
    },
  }
}
