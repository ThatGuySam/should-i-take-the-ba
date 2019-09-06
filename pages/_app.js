import '../styles/styles.css'

import React from 'react'
import App from 'next/app'

export default class Should extends App {
  render () {
    const { Component, pageProps } = this.props

    return <Component {...pageProps} />
  }
}