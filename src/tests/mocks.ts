import {resource} from '..'
import {sleep} from './utils'

export const MOCK_FNS = {
  a: {
    fetch: jest.fn(),
    sumRequest: jest.fn(),
    getRequest: jest.fn(),
  },
  b: {
    fetch: jest.fn(),
    addAction: jest.fn(),
    deleteAction: jest.fn(),
  },
  c: {
    fetch: jest.fn(),
  },
  d: {
    fetch: jest.fn(),
  },
}

const resourceA = resource(async ({ids, query}) => {
  MOCK_FNS.a.fetch()
  await sleep(50)
  return [
    {id: 'a1', b_id: 'b5', b_ids: ['b1', 'b2', 'b3']},
    {id: 'a2', b_id: 'b4', b_ids: ['b4', 'b5']},
    {id: 'a3', b_id: 'b3', b_ids: ['b1', 'b3', 'b5']},
  ]
})
  .sanitizeQuery()
  .request('aSum', async () => {
    MOCK_FNS.a.sumRequest()
    await sleep(50)
    return 100
  })
  .request('oneA', async (a: void, r) => {
    MOCK_FNS.a.getRequest()
    return {myA: r({id: 'a1', b_id: 'b1', b_ids: ['b1', 'b2', 'b3']})}
  })
  .action('updateA1', async (body: void, u) => {
    u.upsert({id: 'a1', b_id: 'b2'})
  })
  .action('reloadAll', async (body: void, u) => {
    u.reload()
  })

export type TypeB = {id: string; value: number}
const resourceB = resource<TypeB, {error?: boolean; returnEmpty?: boolean}>(async ({ids, query}) => {
  MOCK_FNS.b.fetch()
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
    MOCK_FNS.b.addAction()
    await sleep(50)
    u.upsert(newB)
    return newB
  })
  .action('deleteB', async (id: string, u) => {
    MOCK_FNS.b.deleteAction()
    u.remove(id)
  })
  .watch('b.created', (b, ev, {upsert}) => upsert(ev.payload))
  .action('errorB', async () => {
    await sleep(25)
    throw 'ERROR: errorB'
  })

const resourceC = resource<{id: string; value: number}, {error?: boolean}>(async ({ids, query}) => {
  MOCK_FNS.c.fetch()
  await sleep(50)
  return [
    {id: 'c1', value: 10},
    {id: 'c2', value: 20},
  ]
})
  .watch('c.deleted', (b, e, u) => u.remove('c2'))
  .request('embeddedC', async (b, r) => r({id: 'c1', value: 10}))

const resourceD = resource<{id: string}>(async ({ids, query}) => {
  MOCK_FNS.d.fetch()
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

export const MOCK_RESOURCES = {
  a: resourceA,
  b: resourceB,
  c: resourceC,
  d: resourceD,
}

export const localStorageMock = () => {
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
