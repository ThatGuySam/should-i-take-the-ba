import axios from 'axios'

export default async function ({ origin, destination }) {


    // https://maps.googleapis.com/maps/api/directions/json?origin=36.144100,-95.983615&destination=36.038320,-95.742998&key=GOOGLE_KEY&departure_time=now

    const apiUrl = 'https://maps.googleapis.com/maps/api/directions/json'

    const params = {
        origin,
        destination,
        key: process.env.GOOGLE_KEY,
        departure_time: 'now'
    }

    const { data } = await axios.get(apiUrl, {
        params
    })

    return data
}