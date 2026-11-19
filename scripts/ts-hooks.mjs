// Lets Node run the TypeScript sources directly (Node strips types itself):
// the sources use extensionless relative imports, as Vite allows, so retry those with ".ts".
import { registerHooks } from 'node:module'

registerHooks({
  resolve(specifier, context, next) {
    try {
      return next(specifier, context)
    } catch (err) {
      if (/^\.{1,2}\//.test(specifier) && !/\.[cm]?[jt]s$/.test(specifier)) return next(`${specifier}.ts`, context)
      throw err
    }
  },
})
