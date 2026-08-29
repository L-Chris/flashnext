import 'reflect-metadata'
import Koa from 'koa'
import { Container } from 'typedi'
import { routingConfigs } from './routing.options'
import { useMiddlewares } from './koa.middlewares'
import { useKoaServer, useContainer } from 'routing-controllers'
import { prisma } from 'app/shared/prisma'

const createServer = async (): Promise<Koa> => {
  await prisma.$connect()
  console.log('init: prisma connected')

  const koa: Koa = new Koa({ proxy: true })

  useMiddlewares(koa)

  useContainer(Container)

  const app: Koa = useKoaServer<Koa>(koa, routingConfigs)

  app.on('error', (err: any, ctx) => {
    if (err?.code === 'EPIPE' || err?.code === 'ECONNRESET') return
    console.error('[koa.app.error]', err, {
      url: ctx?.originalUrl || ctx?.url,
      method: ctx?.method,
    })
  })

  return app
}

export default createServer
