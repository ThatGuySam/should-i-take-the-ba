import axios from 'axios'

import currentDomain from '../currentDomain'

export default async function ({ origin, destination, departure_time = 'now' }) {

    const requestDomain = currentDomain.get()

    const apiUrl = `${requestDomain}/api/directions`

    // console.log({ apiUrl })

    const params = {
        origin,
        destination,
        departure_time
    }

    const { data } = await axios.get(apiUrl, {
        params
    })

    return data
}