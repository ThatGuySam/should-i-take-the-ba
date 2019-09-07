const FontFaceObserver = require('fontfaceobserver')

const Fonts = () => {
  const link = document.createElement('link')
  link.href = 'https://use.typekit.net/tff1ryu.css'
  link.rel = 'stylesheet'

  document.head.appendChild(link)

  const interstate = new FontFaceObserver('interstate')

  interstate.load().then(() => {
    document.documentElement.classList.add('interstate-ready')
  })
}

export default Fonts