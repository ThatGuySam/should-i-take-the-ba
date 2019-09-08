import React, { Component } from 'react'
import Head from 'next/head'

import { baEastBound } from '../config'
import currentDomain from '../lib/currentDomain'
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

class IgMockup extends Component {

    static async getInitialProps ({ req }) {
      // Save request domain
      currentDomain.setFromRequest(req)

      // https://maps.googleapis.com/maps/api/directions/json?origin=36.144100,-95.983615&destination=36.038320,-95.742998&key={{BA_EXPY_KEY}}&departure_time=now
      
      // const origin = '36.144100,-95.983615'
      // const destination = '36.038320,-95.742998'

      const { origin, destination } = baEastBound

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

                  {(shouldTake !== null) && (
                      <div 
                        className='ig-frame flex mx-auto p-3'
                        style={{
                          minHeight: 270,
                          maxHeight: 308,
                          maxWidth: 270,
                          transform: 'scale(3)',
                        }}
                      >
                        <Messaging
                          className='flex flex-col justify-center text-white rounded-lg p-5 pb-10'
                          style={{
                            backgroundColor: (shouldTake) ? '#35c28c' : '#f34f49'
                          }}
                          {...{
                            shouldTake,
                            checkedDate,
                            humanReadableDelay: this.humanReadableDelay
                          }}
                        />
                      </div>
                    )}

                </div>

              </div>

            </div>
        )
    }
}

export default IgMockup
