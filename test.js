/** Messing around with what future api could look like */

// shared definitions
const usersNS = defineNamespace(t => ({
  id: t.id(),
  name: t.string(),
}))

const tasksNS = defineNamespace(t => ({
  id: t.id(),
  user_id: t.ref(usersNS),
  status: t.bool(),
}))
  .query(['status'])
  .aggregate('count', t => t.int())

const sessionNS = defineNamespace()

const COLLECTION = defineCollection({
  users: usersNS,
  tasks: tasksNS,
  session: sessionNS,
})

// server
const server = createServer(COLLECTION)

server.users.onList(() => {
  return []
})

server.tasks.onList(() => {
  return []
})

server.tasks.onGetId(() => {
  return {}
})

// client

// if BE not supported

const $api = mockServeCollection(COLLECTION)

$api.users.onList(() => {
  return []
})

$api.tasks.onList(() => {
  return []
})

$api.tasks.onGetId(() => {
  return {}
})

// could have different clients for different frameworks
const $client = createReactClient(COLLECTION, $api) // server mock is optional

$client.users.use()
$client.tasks.use()
