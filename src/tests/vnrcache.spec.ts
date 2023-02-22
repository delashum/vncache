import {act, renderHook} from '@testing-library/react-hooks'
import {useState} from 'react'

import {createResourceCache, resource} from '..'

// MOCKS

const localStorageMock = () => {
  const store = new Map<string, string>()
  return {
    clear: () => store.clear(),
    getItem: (key: string) => store.get(key),
    key: (index: number) => [...store.keys()][index],
    get length() {
      return store.size
    },
    removeItem: (key: string) => store.delete(key),
    setItem: (key: string, value: string) => store.set(key, value),
  }
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

const aFetch = jest.fn()
const aSumRequest = jest.fn()
const aGetRequest = jest.fn()
const bFetch = jest.fn()
const bAddAction = jest.fn()
const bDeleteAction = jest.fn()
const cFetch = jest.fn()

// CACHE SETUP

const resourceA = resource(async ({ids, query}) => {
  aFetch()
  await sleep(50)
  return [
    {id: 'a1', b_id: 'b5', b_ids: ['b1', 'b2', 'b3']},
    {id: 'a2', b_id: 'b4', b_ids: ['b4', 'b5']},
    {id: 'a3', b_id: 'b3', b_ids: ['b1', 'b3', 'b5']},
  ]
})
  .sanitizeQuery()
  .request('aSum', async () => {
    aSumRequest()
    await sleep(50)
    return 100
  })
  .request('oneA', async (a: void, r) => {
    aGetRequest()
    return {myA: r({id: 'a1', b_id: 'b1', b_ids: ['b1', 'b2', 'b3']})}
  })
  .action('updateA1', async (body: void, u) => {
    u.upsert({id: 'a1', b_id: 'b2'})
  })
  .action('reloadAll', async (body: void, u) => {
    u.reload()
  })

type TypeB = {id: string; value: number}
const resourceB = resource<TypeB, {error?: boolean; returnEmpty?: boolean}>(async ({ids, query}) => {
  bFetch()
  await sleep(50)
  if (query?.error) throw 'ERROR: resourceB'
  if (query?.returnEmpty) return []
  return [
    {id: 'b1', value: 1},
    {id: 'b2', value: 2},
    {id: 'b3', value: 3},
    {id: 'b4', value: 4},
    {id: 'b5', value: 5},
  ]
})
  .sanitizeQuery(b => (b.query ? b : {}))
  .action('addB', async (newB: {id: string; value: number}, u) => {
    bAddAction()
    await sleep(50)
    u.upsert(newB)
    return newB
  })
  .action('deleteB', async (id: string, u) => {
    bDeleteAction()
    u.remove(id)
  })
  .watch('b.created', (b, ev, {upsert}) => upsert(ev.payload))
  .action('errorB', async () => {
    await sleep(25)
    throw 'ERROR: errorB'
  })

const resourceC = resource<{id: string; value: number}, {error?: boolean}>(async ({ids, query}) => {
  cFetch()
  await sleep(50)
  return [
    {id: 'c1', value: 10},
    {id: 'c2', value: 20},
  ]
})
  .watch('c.deleted', (b, e, u) => u.remove('c2'))
  .request('embeddedC', async (b, r) => r({id: 'c1', value: 10}))

const resourceD = resource<{id: string}>(async ({ids, query}) => {
  cFetch()
  await sleep(50)
  return [{id: 'd1'}]
}).request(
  'randomData',
  async (b, r) => {
    return {
      one: 1,
      two: 2,
      three: 3,
    }
  },
  [
    [
      'randomData.squared',
      (_, __, {patch}) => {
        patch({two: 4, three: 9})
      },
    ],
  ]
)

const resources = {
  a: resourceA,
  b: resourceB,
  c: resourceC,
  d: resourceD,
}

// SETUP

beforeAll(() => {
  window.localStorage = localStorageMock()
})
beforeEach(() => {
  jest.clearAllMocks()
  window.localStorage.clear()
})

// TESTS

describe('vnrcache', () => {
  describe('resources', () => {
    it('basic resolve works', async () => {
      const $cache = createResourceCache(resources)
      const resA = await $cache.a.resolve()
      expect(aFetch).toHaveBeenCalledTimes(1)
      expect(bFetch).toHaveBeenCalledTimes(0)
      expect(resA).toHaveLength(3)
    })
    it('fetch by id works', async () => {
      const $cache = createResourceCache(resources)
      const resA1 = await $cache.a.resolve()
      const resA2 = await $cache.a.ids('a2').resolve()
      const resB = await $cache.b.ids('b4').resolve()
      expect(aFetch).toHaveBeenCalledTimes(1)
      expect(bFetch).toHaveBeenCalledTimes(1)
      expect(resA1).toHaveLength(3)
      expect(resA2).toHaveLength(1)
      expect(resB).toHaveLength(1)
      expect(resA2[0]).toBeDefined()
      expect(resA2[0].b_id).toEqual('b4')
      expect(resB[0].id).toEqual('b4')
    })
    it('nesting works', async () => {
      const $cache = createResourceCache(resources)
      const [a1] = await $cache.a.ids('a1').nest('b_id', $cache.b).nest('b_ids', $cache.b).resolve()
      expect(aFetch).toHaveBeenCalledTimes(1)
      expect(bFetch).toHaveBeenCalledTimes(1)
      expect(a1).toBeDefined()
      expect(a1.b).toBeDefined()
      expect(a1.b).toEqual({id: 'b5', value: 5})
      expect(a1.bs).toBeDefined()
      expect(a1.bs).toHaveLength(3)
    })
    it('cacheTimeout works', async () => {
      const $cache = createResourceCache(resources, {cacheTimeout: 100})
      const resA1 = await $cache.a.resolve()
      expect(resA1).toHaveLength(3)
      expect(aFetch).toHaveBeenCalledTimes(1)
      await sleep(50)
      const resA2 = await $cache.a.resolve()
      expect(resA2).toHaveLength(3)
      expect(aFetch).toHaveBeenCalledTimes(1)
      await sleep(150)
      const resA3 = await $cache.a.resolve()
      expect(resA3).toHaveLength(3)
      expect(aFetch).toHaveBeenCalledTimes(2)
    })
  })

  describe('requests', () => {
    it('works', async () => {
      const $cache = createResourceCache(resources)
      const resA1 = await $cache.a.fetch('aSum', null).resolve()
      expect(aSumRequest).toHaveBeenCalledTimes(1)
      expect(resA1).toEqual(100)
    })
    it('caching works', async () => {
      const $cache = createResourceCache(resources)
      const resA1 = await $cache.a.fetch('aSum', null).resolve()
      const resA2 = await $cache.a.fetch('aSum', null).resolve()
      expect(aSumRequest).toHaveBeenCalledTimes(1)
      expect(resA1).toEqual(100)
      expect(resA2).toEqual(100)
    })
    it('embedded resources works', async () => {
      const $cache = createResourceCache(resources)
      const {myA} = await $cache.a.fetch('oneA', null).resolve()
      expect(aGetRequest).toHaveBeenCalledTimes(1)
      expect(aSumRequest).toHaveBeenCalledTimes(0)
      expect(aFetch).toHaveBeenCalledTimes(0)
      expect(myA).toBeDefined()
      expect(myA.id).toEqual('a1')
    })
    it('cacheTimeout works', async () => {
      const $cache = createResourceCache(resources, {cacheTimeout: 100})
      const fetcher = $cache.a.fetch('aSum', null)
      const resA1 = await fetcher.resolve()
      expect(resA1).toEqual(100)
      expect(aSumRequest).toHaveBeenCalledTimes(1)
      await sleep(50)
      const resA2 = await fetcher.resolve()
      expect(resA2).toEqual(100)
      expect(aSumRequest).toHaveBeenCalledTimes(1)
      await sleep(150)
      const resA3 = await fetcher.resolve()
      expect(resA3).toEqual(100)
      expect(aSumRequest).toHaveBeenCalledTimes(2)
    })
  })

  describe('actions', () => {
    it('action upsert adds', async () => {
      const $cache = createResourceCache(resources)
      const resB1 = await $cache.b.resolve()
      expect(resB1).toHaveLength(5)
      const newB = await $cache.b.do('addB', {id: 'b6', value: 6})
      expect(newB).toEqual({id: 'b6', value: 6})
      const resB2 = await $cache.b.resolve()
      expect(resB2).toHaveLength(6)
      expect(bFetch).toHaveBeenCalledTimes(1)
      expect(bAddAction).toHaveBeenCalledTimes(1)
    })
    it('action upsert patchs', async () => {
      const $cache = createResourceCache(resources)
      const resB1 = await $cache.b.resolve()
      expect(resB1).toHaveLength(5)
      const [updatedB1] = await $cache.b.ids('b2').resolve()
      expect(updatedB1).toEqual({id: 'b2', value: 2})
      const newB = await $cache.b.do('addB', {id: 'b2', value: 200})
      expect(newB).toEqual({id: 'b2', value: 200})
      const resB2 = await $cache.b.resolve()
      expect(resB2).toHaveLength(5)
      const [updatedB2] = await $cache.b.ids('b2').resolve()
      expect(updatedB2).toEqual({id: 'b2', value: 200})
      expect(bFetch).toHaveBeenCalledTimes(1)
      expect(bAddAction).toHaveBeenCalledTimes(1)
    })
    it('action updates reload embedded request resources', async () => {
      const $cache = createResourceCache(resources)
      const res1 = await $cache.a.fetch('oneA', null).resolve()
      expect(aGetRequest).toHaveBeenCalledTimes(1)
      expect(aSumRequest).toHaveBeenCalledTimes(0)
      expect(aFetch).toHaveBeenCalledTimes(0)
      expect(res1.myA).toBeDefined()
      expect(res1.myA.id).toEqual('a1')
      expect(res1.myA.b_id).toEqual('b1')

      await $cache.a.do('updateA1', null)
      const res2 = await $cache.a.fetch('oneA', null).resolve()
      expect(aGetRequest).toHaveBeenCalledTimes(1)
      expect(aSumRequest).toHaveBeenCalledTimes(0)
      expect(aFetch).toHaveBeenCalledTimes(0)
      expect(res2.myA).toBeDefined()
      expect(res2.myA.id).toEqual('a1')
      expect(res2.myA.b_id).toEqual('b2')
    })
    it('action remove works', async () => {
      const $cache = createResourceCache(resources)
      const resB1 = await $cache.b.resolve()
      expect(resB1).toHaveLength(5)
      await $cache.b.do('deleteB', 'b1')
      const resB2 = await $cache.b.resolve()
      expect(resB2).toHaveLength(4)
      expect(bFetch).toHaveBeenCalledTimes(1)
      expect(bDeleteAction).toHaveBeenCalledTimes(1)
    })
    it('action reload works', async () => {
      const $cache = createResourceCache(resources)
      const resA1 = await $cache.a.resolve()
      expect(aFetch).toHaveBeenCalledTimes(1)
      expect(resA1).toHaveLength(3)
      expect(resA1[0].b_id).toEqual('b5')

      await $cache.a.do('updateA1', null)
      const resA2 = await $cache.a.resolve()
      expect(aFetch).toHaveBeenCalledTimes(1)
      expect(resA2).toHaveLength(3)
      expect(resA2[0].b_id).toEqual('b2')

      await $cache.a.do('reloadAll', null)
      const resA3 = await $cache.a.resolve()
      expect(aFetch).toHaveBeenCalledTimes(2)
      expect(resA3).toHaveLength(3)
      expect(resA3[0].b_id).toEqual('b5')
    })
  })

  describe('batch', () => {
    it('batching works with multiple resources', async () => {
      const $cache = createResourceCache(resources)
      const [resA, resB] = await $cache.batch($cache.a, $cache.b).resolve()
      expect(aFetch).toHaveBeenCalledTimes(1)
      expect(bFetch).toHaveBeenCalledTimes(1)
      expect(resA).toHaveLength(3)
      expect(resB).toHaveLength(5)
    })
    it('batching works with mixed types', async () => {
      const $cache = createResourceCache(resources)
      const [resA, resB] = await $cache.batch($cache.a, $cache.a.fetch('aSum')).resolve()
      expect(aFetch).toHaveBeenCalledTimes(1)
      expect(aSumRequest).toHaveBeenCalledTimes(1)
      expect(resA).toHaveLength(3)
      expect(resB).toEqual(100)
    })
  })

  describe('error handling', () => {
    // TODO
  })
  describe('events', () => {
    it('inserts new resource to empty cache', async () => {
      const $cache = createResourceCache(resources)
      const {result, waitForNextUpdate} = renderHook(() => $cache.b.query({returnEmpty: true}).use())
      await waitForNextUpdate()
      expect(result.current).toHaveLength(0)
      const newB: TypeB = {id: 'new', value: 1}
      await act(async () => {
        $cache.publish({name: 'b.created', payload: newB}, false)
        await waitForNextUpdate()
      })
      expect(result.current).toHaveLength(1)
      const newB1: TypeB = {id: 'new2', value: 2}
      await act(async () => {
        $cache.publish({name: 'b.created', payload: newB1}, false)
        await waitForNextUpdate()
      })
      expect(result.current).toHaveLength(2)
    })
    it('inserts new resource to list all cache', async () => {
      const $cache = createResourceCache(resources)
      const p1 = $cache.b.ids('b1').resolve()
      const p2 = $cache.b.resolve()
      const [r1, r2] = await Promise.all([p1, p2])
      expect(r1).toHaveLength(1)
      expect(r2.length).toBeGreaterThan(1)
      const newB1: TypeB = {id: 'new2', value: 2}
      $cache.publish({name: 'b.created', payload: newB1}, false)
      const r3 = await $cache.b.resolve()
      expect(r3).toHaveLength(6)
    })
    it('update request body from request watcher', async () => {
      const $cache = createResourceCache(resources)
      const fetcher = $cache.d.fetch('randomData')
      const d1 = await fetcher.resolve()
      expect(d1).toEqual({one: 1, two: 2, three: 3})
      $cache.publish({name: 'randomData.squared'}, false)
      const d2 = await fetcher.resolve()
      expect(d2).toEqual({one: 1, two: 4, three: 9})
    })
  })

  describe('use', () => {
    it('works', async () => {
      const $cache = createResourceCache(resources)
      const {result, waitForNextUpdate} = renderHook(() => $cache.a.use())
      await waitForNextUpdate()
      expect(result.current).toHaveLength(3)
    })
    it('updates live', async () => {
      const $cache = createResourceCache(resources)
      const {result, waitForNextUpdate} = renderHook(() => $cache.b.use())
      await waitForNextUpdate()
      expect(result.current).toHaveLength(5)
      $cache.b.do('addB', {id: 'b6', value: 6})
      await waitForNextUpdate()
      expect(result.current).toHaveLength(6)
      expect(bFetch).toHaveBeenCalledTimes(1)
    })
    it('listens to id changes', async () => {
      const $cache = createResourceCache(resources)
      const {result, waitForNextUpdate} = renderHook(() => {
        const [id, setId] = useState('a1')
        const as = $cache.a.ids(id).use()
        return {as, setId}
      })
      await waitForNextUpdate()
      expect(result.current.as).toHaveLength(1)
      expect(result.current.as[0].id).toEqual('a1')
      act(() => {
        result.current.setId('a2')
      })
      expect(result.current.as).toHaveLength(1)
      expect(result.current.as[0].id).toEqual('a2')
    })
    it('embedded resources are live', async () => {
      const $cache = createResourceCache(resources)
      const {result, waitForNextUpdate} = renderHook(() => $cache.a.fetch('oneA', null).use())
      await waitForNextUpdate()
      expect(result.current.myA).toBeDefined()
      expect(result.current.myA.id).toEqual('a1')
      expect(result.current.myA.b_id).toEqual('b1')

      await act(async () => {
        await $cache.a.do('updateA1', null)
      })

      expect(result.current.myA).toBeDefined()
      expect(result.current.myA.id).toEqual('a1')
      expect(result.current.myA.b_id).toEqual('b2')
    })
    it('event updates work with hooks', async () => {
      const $cache = createResourceCache(resources, {eventDebounce: 50, cacheTimeout: 100})
      const hook1 = renderHook(() => $cache.c.use())
      await hook1.waitForNextUpdate()
      expect(hook1.result.current).toHaveLength(2)
      await act(async () => {
        $cache.c.fetch('embeddedC').resolve()
        await sleep(500)
      })
      const {result: result2, waitForNextUpdate: wait2} = renderHook(() => $cache.c.use())
      wait2()
      expect(result2.current).toHaveLength(2)
      expect(cFetch).toHaveBeenCalledTimes(1)
    })
    xit('handles errors', async () => {
      const $cache = createResourceCache(resources)
      const {result, waitForNextUpdate, rerender} = renderHook(
        ({error}: {error: boolean}) => $cache.b.query({error}).use(),
        {initialProps: {error: false}}
      )
      await waitForNextUpdate()
      expect(result.current.error).toBeNull()
      rerender({error: true})
      await waitForNextUpdate()
      expect(result.error).toEqual('ERROR: errorB')
      expect(bFetch).toHaveBeenCalledTimes(2)
    })
  })
})
