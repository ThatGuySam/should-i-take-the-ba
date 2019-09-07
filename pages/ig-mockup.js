import React, { Component } from 'react'
import Head from 'next/head'

import { ba_eb } from '../config'
import getDirections from '../lib/googleMaps/directions'

import Messaging from '../components/messaging'


const getNumbers = (leg) => {
  const { duration, duration_in_traffic } = leg

  const delayInSeconds = (duration_in_traffic.value - duration.value)
  const delayInMinutes = Math.round(delayInSeconds / 60)

  return {
    duration,
    duration_in_traffic,
    delay: {
      text: `${delayInMinutes} mins`,
      value: delayInSeconds
    }
  }
}

class Home extends Component {

    static async getInitialProps ({ ctx }) {

      // https://maps.googleapis.com/maps/api/directions/json?origin=36.144100,-95.983615&destination=36.038320,-95.742998&key={{BA_EXPY_KEY}}&departure_time=now
      
      // const origin = '36.144100,-95.983615'
      // const destination = '36.038320,-95.742998'

      const { origin, destination } = ba_eb

      const directions = await getDirections({
        origin,
        destination
      })

      return {
        directions: {
          ...directions,
          requestedAt: new Date()
        },
        origin,
        destination
      }
    }

    constructor(props) {
      // Required step: always call the parent class' constructor
      super(props)
  
      this.state = {
        ...getNumbers(props.directions.routes[0].legs[0]),
        shouldTake: null
      }
    }

    componentDidMount = () => {
      const { duration, delay } = this.state

      this.setState({
        shouldTake: this.shouldTake({ duration, delay })
      })
    }

    get mapUrl () {
      const { origin, destination } = this.props
      
      return `https://www.google.com/maps/dir/'${ origin }'/'${ destination }'`
    }

    get humanReadableDelay () {
      const { delay } = this.state

      if (delay.value < 0) return 'No delay. Traffic is running faster than normal'

      if (delay.value < 60) return `Delay is ${delay.value} seconds`

      const delayInMinutes = Math.round(delay.value / 60)

      return `Delay is ${delayInMinutes} minutes`
    }

    shouldTake = ({duration, delay, threshold = 0.20}) => {
      const delayLimit = duration.value * threshold

      return delay.value < delayLimit
    }

    render () {
        const { directions } = this.props

        const { shouldTake } = this.state

        const checkedDate = new Date(directions.requestedAt).toLocaleString('en-US', { hour: 'numeric',  minute: 'numeric', hour12: true })

        return (
            <div>
              <Head>
                <title>Should I Take The BA</title>
              </Head>

              <div className='container mx-auto px-5 py-10'>

                <div className='flex items-center min-h-screen mb-4'>
                  <div className='w-full'>

                    {(shouldTake !== null) && (
                      <Messaging
                        className='mx-auto p-5'
                        style={{
                          minHeight: 270,
                          maxWidth: 270,
                          transform: 'scale(2)'
                        }}
                        {...{
                          shouldTake,
                          checkedDate,
                          humanReadableDelay: this.humanReadableDelay
                        }}
                      />
                    )}

                  </div>
                </div>

              </div>

            </div>
        )
    }
}

export default Home
