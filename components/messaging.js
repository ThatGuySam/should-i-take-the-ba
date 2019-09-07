import React from 'react'

const Messaging = ({ shouldTake, humanReadableDelay, checkedDate, mapUrl, heightClasses = '', className = '', style = null }) => (
  <div className={`messaging text-center my-5 ${heightClasses} ${className}`} style={style}>
      <div className='text-6xl font-bold'>{ shouldTake ? 'Yes' : 'No' }</div>
      <div className='text-xl font-light mb-3'>{ humanReadableDelay } as of { checkedDate }</div>
  </div>
)

export default Messaging
