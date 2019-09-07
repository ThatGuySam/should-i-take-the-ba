import React, { Component } from 'react'
import getDirections from '../lib/google-maps/directions'
import Head from 'next/head'

// import Nav from '../components/nav'


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
      
      const origin = '36.144100,-95.983615'

      const destination = '36.038320,-95.742998'

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

        const { duration, duration_in_traffic, delay, shouldTake } = this.state

        const checkedDate = new Date(directions.requestedAt).toLocaleString('en-US', { hour: 'numeric',  minute: 'numeric', hour12: true })

        return (
            <div>
              <Head>
                <title>Should I Take The BA</title>
              </Head>

              <div className='container mx-auto px-5 py-10'>

                <div className='flex mb-4'>
                  <div className='w-full'>

                    <div className='text-xl text-center mb-4'>Should I take the BA?</div>

                    {(shouldTake !== null) && (
                      <div className='messaging text-center my-5'>
                        <div className='text-6xl font-bold'>{ shouldTake ? 'Yes' : 'No' }</div>
                        <div className='text-xl font-light mb-3'>{ this.humanReadableDelay } as of { checkedDate }</div>
                        <a href={this.mapUrl} className='btn inline-block text-sm bg-transparent border hover:border-gray-800 rounded py-1 px-3 m-3'>View Map</a>
                      </div>
                    )}

                    <hr />

                    <div className='traffic-details text-center my-4'>
                        Delay is { delay.text }
                        <pre>{ delay.value }</pre>
                        <br />
                        Standard Duration is { duration_in_traffic.text }
                        <pre>{ duration.value }</pre>
                        <br />
                        Current Duration is { duration_in_traffic.text }
                        <pre>{ duration_in_traffic.value }</pre>
                        <br />
                    </div>

                  </div>
                </div>

                <div className='flex mb-4'>
                  <div className='w-full '>

                    <pre className='overflow-x-scroll border rounded p-4'>{ JSON.stringify(directions.routes[0].legs[0], null, 2) }</pre>

                  </div>
                </div>

              </div>

            </div>
        )
    }
}

export default Home
