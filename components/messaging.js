import React from 'react'

const Messaging = ({ shouldTake, humanReadableDelay, checkedDate, mapUrl, heightClasses = '', className = '', style = null }) => (
  <div className={`messaging text-center ${heightClasses} ${className}`} style={style}>
      <div className='text-6xl font-bold'>{ shouldTake ? 'Yes' : 'No' }</div>
      <div className='text-xl font-light'>{ humanReadableDelay } as of { checkedDate }</div>
  </div>
)

export default Messaging
