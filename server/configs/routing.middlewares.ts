import { KoaMiddlewareInterface, Middleware } from 'routing-controllers'
import { Service } from 'typedi'

@Middleware({ type: 'before' })
@Service()
export class HeaderMiddleware implements KoaMiddlewareInterface {
  async use(context: any, next: (err?: any) => any): Promise<any> {
    context.set('Access-Control-Allow-Methods', 'GET,HEAD,PUT,POST,DELETE,PATCH')
    context.set(
      'Access-Control-Allow-Origin',
      context.request.header.origin || context.request.origin,
    )
    context.set('Access-Control-Allow-Headers', ['content-type'])
    context.set('Access-Control-Allow-Credentials', 'true')
    return next()
  }
}

@Middleware({ type: 'before', priority: 1000 })
@Service()
export class ApplicationErrorMiddleware implements KoaMiddlewareInterface {
  async use(context: any, next: (err?: any) => any): Promise<any> {
    try {
      return await next()
    } catch (error: any) {
      context.status = error?.status || 500
      context.body = {
        data: false,
        errcode: error?.code || 50000,
        message: error?.message || 'Internal Server Error',
      }
      return context.body
    }
  }
}
