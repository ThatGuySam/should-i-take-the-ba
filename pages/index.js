import React, { Component } from 'react'
import getDirections from '../lib/google-maps/directions'
import Head from 'next/head'

import Nav from '../components/nav'


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
      
      // console.log('process.env.GOOGLE_KEY', process.env.GOOGLE_KEY)

      const directions = await getDirections({
        origin: '36.144100,-95.983615',
        destination: '36.038320,-95.742998'
      })

      return {
        directions: {
          ...directions,
          requestedAt: new Date()
        }
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
                <title>Home</title>
              </Head>

              <Nav />

              <div className='container mx-auto px-5'>

                <div className='flex mb-4'>
                  <div className='w-full'>

                    <div className='text-xl text-center mb-4'>Should I take the BA?</div>

                    {(shouldTake !== null) && (
                      <div className='messaging text-center my-5'>
                        <div className='text-6xl font-bold'>{ shouldTake ? 'Yes' : 'No' }</div>
                        <div>as of { checkedDate }</div>
                      </div>
                    )}

                    <hr />

                    <div className='traffic-details my-4'>
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

                    <pre>{ JSON.stringify(directions.routes[0].legs[0], null, 2) }</pre>

                  </div>
                </div>

              </div>

            </div>
        )
    }
}

export default Home
