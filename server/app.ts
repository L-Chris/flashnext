import 'reflect-metadata'
import { Server } from 'http'
import { PORT, ENV_LABEL } from 'configs/constants'
import createServer from 'configs/application'

module.exports = (async (): Promise<Server> => {
  try {
    const app = await createServer()
    return app.listen(PORT, () => {
      console.log(`FlashNext server listening on ${PORT}, in ${ENV_LABEL} mode.`)
    })
  } catch (e) {
    console.error('[startup] failed to start server', e)
  }
})()
