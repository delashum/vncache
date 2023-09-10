import {useEffect, useState} from 'react'

import {
  BasicResource,
  CommandContext,
  ExtractTypesFromResource,
  InternalResourceCacheData,
  ResourceCacheInstance,
  ResourceCacheOptions,
  ResourceInstance,
  UnArray,
} from './types'
import {arrayToMap, concrete, distinct, ensureArray} from './utilities'

/**
 * Creates a closure for each chained method when consuming a resource. This allows reusability and isolates state.
 *
 * Example:
 * const one = $cache.users
 * const two = one.query(...)
 *
 * In this example one & two will not have any shared state because the context is copied into each new closure.
 * This allows each closure to have access to all previously chained configurations without affecting any others
 *
 * @param resourceName name of the resource we are operating on. e.g. 'users' or 'accounts'
 * @param resourceInstance the InternalResourceInstance that we get back calling __compile. contains all resource configuration
 * @param options global options set on a resourceCache level and shared by all queries and resources in that cache
 * @param context state that is copied and passed to each new closure
 * @returns a resource cache instance
 */
export const createRequestClosure = <RInstance extends ResourceInstance<any>>(
  resourceName: string,
  resourceInstance: ReturnType<RInstance['__compile']>,
  options: ResourceCacheOptions = {},
  context: CommandContext = {nest: [], body: {}, cacheKey: '{}', type: null}
): ResourceCacheInstance<ExtractTypesFromResource<RInstance>> => {
  const sanitizedBody = resourceInstance.sanitizeQuery({})
  resourceInstance.store.resource.register({}, sanitizedBody, resourceInstance.fn)

  /** helper function that creates a copy of context with any additions to pass to next closure */
  const updateContext = <T extends ResourceCacheInstance<any, any> & InternalResourceCacheData>(
    cache: T,
    updates: {query?: any; ids?: string[]; nest?: UnArray<CommandContext['nest']>; fetch?: {body: any; key: string}}
  ): CommandContext => {
    const updatedContext = {...cache.__context}
    if ('fetch' in updates) {
      updatedContext.type = 'fetch'
      updatedContext.body = updates.fetch.body ?? {}
      updatedContext.cacheKey = resourceInstance.store.object.register(
        updates.fetch.key,
        updatedContext.body,
        resourceInstance.requests[updates.fetch.key]
      )
    }
    if ('nest' in updates) updatedContext.nest = [...updatedContext.nest, updates.nest]
    if ('query' in updates || 'ids' in updates) {
      updatedContext.type = 'resource'
      const newBody = {...cache.__context.body}
      if ('query' in updates) newBody.query = updates.query
      if ('ids' in updates) newBody.ids = concrete(distinct([...(newBody.ids ?? []), ...updates.ids]))
      const sanitizedBody = resourceInstance.sanitizeQuery(newBody)
      updatedContext.cacheKey = resourceInstance.store.resource.register(newBody, sanitizedBody, resourceInstance.fn)
      updatedContext.body = newBody
    }
    return updatedContext
  }

  /**
   * given a list of resources it will build a query for all nested resources
   *
   * @param items a list of resources to attach nested data to
   * @returns an array of QueryInstance with all needed ids pre encoded
   */
  const getNestedResources = (items: BasicResource[]) => {
    if (items.length === 0) return []
    const resourceIds = new Map<string, Set<string>>()
    for (const n of cache.__context.nest) {
      const name: string = (n.resource as any).__resourceName
      if (!resourceIds.has(name)) resourceIds.set(name, new Set())
      for (const item of items) {
        const ids: string[] = ensureArray(item[n.key])
        for (const id of ids) resourceIds.get(name).add(id)
      }
    }

    return cache.__context.nest.map(n => {
      const name: string = (n.resource as any).__resourceName
      return n.resource.ids(...resourceIds.get(name))
    })
  }

  const transformNestKey = (key: string) => {
    if (!key || typeof key !== 'string') return key
    if (key.includes('_id')) return key.replace('_id', '')
    return 'nested_' + key
  }

  /**
   * returns the same list of resources it was given with all nested data attached
   *
   * @param items any resources
   * @param nestedData all related resources needed for nesting
   * @returns items with new keys attached for nested data
   */
  const nestData = (items: any[], nestedData: any[][]) => {
    const nesters = cache.__context.nest
    const nestedDataMaps = nestedData.map(nd => arrayToMap(nd, 'id'))
    return items.map(item => {
      const copy = {...item}
      for (let i = 0; i < nesters.length; i++) {
        const nestDataMap = nestedDataMaps[i]
        const nestConfig = nesters[i]
        const itemValue = item[nestConfig.key]
        const newKey = transformNestKey(nestConfig.key)
        let newValue = null
        if (itemValue == null) newValue = null
        else if (Array.isArray(itemValue)) newValue = itemValue.map(id => nestDataMap[id])
        else newValue = nestDataMap[itemValue]
        copy[newKey] = newValue
      }
      return copy
    })
  }

  /** a helper function that gets a snapshot of data from cache and attaches all nested data if relevant */
  const getResourceData = () => {
    const items = resourceInstance.store.resource.get(cache.__context.cacheKey)
    const nestedResources = getNestedResources(items)
    const nestedData = nestedResources.map((r: any) => r.__snapshot as any[])
    const finalItems = nestData(items, nestedData)
    Object.assign(finalItems, {error: items.error, loading: items.loading, fromLocal: items.fromLocal})
    return finalItems
  }

  /** same as getResourceData (right above) but returns a promise */
  const resolveResourceData = async (activateCache = false) => {
    const items = await resourceInstance.store.resource.resolve(cache.__context.cacheKey, activateCache)
    const nestedResources = getNestedResources(items)
    const nestedData = await Promise.all(nestedResources.map(r => r.resolve())) // TODO this is problematic because even in use() we will be sending activateCache=true to the cache
    return nestData(items, nestedData)
  }

  /** considers all nested resources and returns if the resource is still loading */
  const isResourceResolving = () => {
    if (resourceInstance.store.resource.isResolving(cache.__context.cacheKey)) return true
    const items = resourceInstance.store.resource.get(cache.__context.cacheKey)
    const nestedResources = getNestedResources(items)
    for (const r of nestedResources) {
      const isResolving: boolean = (r as any).__isResolving
      if (isResolving) return true
    }
    return false
  }

  /** returns an object of useful variables and methods for .use(...)
   * depending on if the query is a `fetch` or a `resource` we route these to different functions
   */
  const useCacheHelpers = () => {
    const isResolving =
      cache.__context.type === 'fetch'
        ? resourceInstance.store.object.isResolving(cache.__context.cacheKey)
        : isResourceResolving()
    const resolver =
      cache.__context.type === 'fetch'
        ? resourceInstance.store.object.resolve(cache.__context.cacheKey)
        : resolveResourceData()
    const getData = () =>
      cache.__context.type === 'fetch' ? resourceInstance.store.object.get(cache.__context.cacheKey) : getResourceData()
    const subscribe =
      cache.__context.type === 'fetch'
        ? resourceInstance.store.object.subscribe
        : resourceInstance.store.resource.subscribeQuery

    return {isResolving, resolver, getData, subscribe}
  }

  const cache: ResourceCacheInstance<ExtractTypesFromResource<RInstance>> & InternalResourceCacheData = {
    query: body => createRequestClosure(resourceName, resourceInstance, options, updateContext(cache, {query: body})),
    ids: (..._ids) => createRequestClosure(resourceName, resourceInstance, options, updateContext(cache, {ids: _ids})),
    nest: (key, resourceCache) =>
      createRequestClosure(
        resourceName,
        resourceInstance,
        options,
        updateContext(cache, {nest: {key, resource: resourceCache}})
      ),
    fetch: (key, body) =>
      createRequestClosure(resourceName, resourceInstance, options, updateContext(cache, {fetch: {key, body}})) as any,
    use: config => {
      config = {suspend: true, throwError: true, enabled: true, ...config}
      const {isResolving, resolver, getData, subscribe} = useCacheHelpers()

      if (config.suspend && isResolving) throw resolver
      const [response, setResponse] = useState(getData)

      useEffect(() => {
        let done = false // use this to "cancel" promise if component derenders before it completes
        if (isResolving)
          resolver.then(res => {
            if (!done) setResponse(res)
          })
        else setResponse(getData())

        const cleanup = subscribe(cache.__context.cacheKey, setResponse)
        return () => {
          cleanup()
          done = true
        }
      }, [cache.__context.cacheKey])

      return response
    },
    preload: () => {
      if (cache.__context.type === 'fetch') resourceInstance.store.object.resolve(cache.__context.cacheKey)
      else resolveResourceData()
    },
    resolve: async () => {
      if (cache.__context.type === 'fetch')
        return await resourceInstance.store.object.resolve(cache.__context.cacheKey, true)
      else return resolveResourceData(true)
    },
    do: (key, body) => {
      const action = resourceInstance.actions[key]
      const response = action(body, {
        remove: ids => resourceInstance.store.resource.remove(ids),
        upsert: items => resourceInstance.store.resource.upsert(items),
        updateAllResources: updates => {
          const allRs = resourceInstance.store.resource.getAllResources()
          const allUpdates =
            typeof updates === 'function'
              ? allRs.map(r => ({...updates(r), id: r.id}))
              : allRs.map(r => ({...updates, id: r.id}))
          resourceInstance.store.resource.upsert(allUpdates)
        },
        reload: which => {
          let caches = resourceInstance.store.resource.getAllActiveCaches()
          if (which) caches = caches.filter(({body}) => which(body))
          for (const {key} of caches) resourceInstance.store.resource.reload(key)
        },
      })
      return response as any
    },

    // private fields
    get __context() {
      return context
    },
    get __resourceName() {
      return resourceName
    },
    get __isResolving() {
      return isResourceResolving()
    },
    get __snapshot(): any[] {
      return getResourceData()
    },
  }
  return cache
}
