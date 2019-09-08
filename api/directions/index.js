import url from 'url'
import axios from 'axios'

export default async function (req, res) {

    const requestUrl = url.parse(req.url, true)
    const { origin, destination, departure_time = 'now' } = requestUrl.query

    // https://maps.googleapis.com/maps/api/directions/json?origin=36.144100,-95.983615&destination=36.038320,-95.742998&key=GOOGLE_KEY&departure_time=now

    const apiUrl = 'https://maps.googleapis.com/maps/api/directions/json'

    // console.log({ apiUrl })

    const params = {
        origin,
        destination,
        departure_time,
        key: process.env.GOOGLE_KEY
    }

    const { data } = await axios.get(apiUrl, {
        params
    })

    res.json(data)
}
