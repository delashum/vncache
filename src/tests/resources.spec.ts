import {createResourceCache} from '..'
import {MOCK_FNS, MOCK_RESOURCES} from './mocks'
import {sleep} from './utils'

describe('resources', () => {
  it('basic resolve works', async () => {
    const $cache = createResourceCache(MOCK_RESOURCES)
    const resA = await $cache.a.resolve()
    expect(MOCK_FNS.a.fetch).toHaveBeenCalledTimes(1)
    expect(MOCK_FNS.b.fetch).toHaveBeenCalledTimes(0)
    expect(resA).toHaveLength(3)
  })
  it('fetch by id works', async () => {
    const $cache = createResourceCache(MOCK_RESOURCES)
    const resA1 = await $cache.a.resolve()
    const resA2 = await $cache.a.ids('a2').resolve()
    const resB = await $cache.b.ids('b4').resolve()
    expect(MOCK_FNS.a.fetch).toHaveBeenCalledTimes(1)
    expect(MOCK_FNS.b.fetch).toHaveBeenCalledTimes(1)
    expect(resA1).toHaveLength(3)
    expect(resA2).toHaveLength(1)
    expect(resB).toHaveLength(1)
    expect(resA2[0]).toBeDefined()
    expect(resA2[0].b_id).toEqual('b4')
    expect(resB[0].id).toEqual('b4')
  })
  it('nesting works', async () => {
    const $cache = createResourceCache(MOCK_RESOURCES)
    const [a1] = await $cache.a.ids('a1').nest('b_id', $cache.b).nest('b_ids', $cache.b).resolve()
    expect(MOCK_FNS.a.fetch).toHaveBeenCalledTimes(1)
    expect(MOCK_FNS.b.fetch).toHaveBeenCalledTimes(1)
    expect(a1).toBeDefined()
    expect(a1.b).toBeDefined()
    expect(a1.b).toEqual({id: 'b5', value: 5})
    expect(a1.bs).toBeDefined()
    expect(a1.bs).toHaveLength(3)
  })
  it('cacheTimeout works', async () => {
    const $cache = createResourceCache(MOCK_RESOURCES, {cacheTimeout: 100})
    const resA1 = await $cache.a.resolve()
    expect(resA1).toHaveLength(3)
    expect(MOCK_FNS.a.fetch).toHaveBeenCalledTimes(1)
    await sleep(50)
    const resA2 = await $cache.a.resolve()
    expect(resA2).toHaveLength(3)
    expect(MOCK_FNS.a.fetch).toHaveBeenCalledTimes(1)
    await sleep(150)
    const resA3 = await $cache.a.resolve()
    expect(resA3).toHaveLength(3)
    expect(MOCK_FNS.a.fetch).toHaveBeenCalledTimes(2)
  })
})
