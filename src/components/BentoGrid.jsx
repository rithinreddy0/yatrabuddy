import React from 'react'
import {Button} from './UI.jsx'

function FeaturedDestination({place, onPlan}) {
  return <article className="home-destination">
    <img src={`/images/${place.image}.jpg`} alt="" loading="lazy" decoding="async" width="480" height="288"/>
    <div className="home-destination-copy">
      <h3>{place.name}</h3>
      <small>{place.theme}</small>
      <Button variant="secondary" aria-label={`Plan a trip to ${place.name}`} onClick={() => onPlan(place.id)}>Plan a trip</Button>
    </div>
  </article>
}

export function BentoExploreSection({catalog, onPlan}) {
  const featured = catalog.slice(0, 4)
  if (!featured.length) return null

  return <section className="home-destinations" aria-labelledby="home-destinations-title">
    <h2 id="home-destinations-title">Featured destinations</h2>
    <div className="home-destination-grid">
      {featured.map(place => <FeaturedDestination key={place.id} place={place} onPlan={onPlan}/>)}
    </div>
  </section>
}
