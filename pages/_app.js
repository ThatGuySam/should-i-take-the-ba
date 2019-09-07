import '../styles/styles.css'

import React from 'react'
import App from 'next/app'

import Fonts from '../lib/fonts'

export default class Should extends App {

  componentDidMount = () => {
    Fonts()
  }

  render () {
    const { Component, pageProps } = this.props

    return <Component {...pageProps} />
  }
}