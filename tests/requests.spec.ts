import {createResourceCache} from '../src'
import {MOCK_FNS, MOCK_RESOURCES} from './helpers/mocks'
import {sleep} from './helpers/utils'

describe('requests', () => {
  it('works', async () => {
    const $cache = createResourceCache(MOCK_RESOURCES)
    const resA1 = await $cache.a.fetch('aSum').resolve()
    expect(MOCK_FNS.a.sumRequest).toHaveBeenCalledTimes(1)
    expect(resA1).toEqual(100)
  })
  it('caching works', async () => {
    const $cache = createResourceCache(MOCK_RESOURCES)
    const resA1 = await $cache.a.fetch('aSum').resolve()
    const resA2 = await $cache.a.fetch('aSum').resolve()
    expect(MOCK_FNS.a.sumRequest).toHaveBeenCalledTimes(1)
    expect(resA1).toEqual(100)
    expect(resA2).toEqual(100)
  })
  it('embedded resources works', async () => {
    const $cache = createResourceCache(MOCK_RESOURCES)
    const {myA} = await $cache.a.fetch('oneA').resolve()
    expect(MOCK_FNS.a.getRequest).toHaveBeenCalledTimes(1)
    expect(MOCK_FNS.a.sumRequest).toHaveBeenCalledTimes(0)
    expect(MOCK_FNS.a.fetch).toHaveBeenCalledTimes(0)
    expect(myA).toBeDefined()
    expect(myA.id).toEqual('a1')
  })
  it('cacheTimeout works', async () => {
    const $cache = createResourceCache(MOCK_RESOURCES, {cacheTimeout: 100})
    const fetcher = $cache.a.fetch('aSum')
    const resA1 = await fetcher.resolve()
    expect(resA1).toEqual(100)
    expect(MOCK_FNS.a.sumRequest).toHaveBeenCalledTimes(1)
    await sleep(50)
    const resA2 = await fetcher.resolve()
    expect(resA2).toEqual(100)
    expect(MOCK_FNS.a.sumRequest).toHaveBeenCalledTimes(1)
    await sleep(150)
    const resA3 = await fetcher.resolve()
    expect(resA3).toEqual(100)
    expect(MOCK_FNS.a.sumRequest).toHaveBeenCalledTimes(2)
  })
})
