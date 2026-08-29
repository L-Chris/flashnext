import { RoutingControllersOptions } from 'routing-controllers'
import * as controllers from 'app/controllers'
import * as middlewares from './routing.middlewares'
import * as interceptors from './interceptors'
import { objectValues } from 'app/shared/objects/to-array'

export const routingConfigs: RoutingControllersOptions = {
  controllers: objectValues(controllers),

  middlewares: objectValues(middlewares),

  interceptors: objectValues(interceptors),

  routePrefix: '/api',

  validation: true,
}
