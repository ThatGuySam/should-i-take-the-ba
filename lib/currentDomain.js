let currentDomain = ''

export default {
  get: () => currentDomain,
  set: (domain) => {
    currentDomain = domain
  },
  setFromRequest: (req) => {
    // console.log('req.headers', req.headers)
    const requestProtocol = req.headers['x-forwarded-proto']
    const host = req.headers['x-forwarded-host']
    
    currentDomain = `${requestProtocol}://${host}`
  }
}