let destinations = []
export function setCatalog(data) { destinations = data }
export const destination = id => destinations.find(item => item.id === id)
export const money = value => new Intl.NumberFormat('en-IN',{style:'currency',currency:'INR',maximumFractionDigits:0}).format(value)
export const time = minutes => `${String(Math.floor(minutes/60)).padStart(2,'0')}:${String(minutes%60).padStart(2,'0')}`
export const themes = ['All places','Nature','Culture','Food','Adventure']
export const modes = ['Itinerary','Stays','Food','Routes']
export function allowedStop(item,brief,day) {
  const diet=brief.diet||'No restrictions'
  if(item.theme==='Food'&&diet!=='No restrictions'&&!item.diet?.includes(diet))return false
  if(!brief.date||!item.closedWeekdays?.length)return true
  const date=new Date(brief.date+'T00:00:00Z')
  const weekday=(date.getUTCDay()+day+6)%7
  return !item.closedWeekdays.includes(weekday)
}
export function matchDestination(query) {
  return destinations.find(item => new RegExp(item.id === 'kerala' ? 'kerala|varkala' : item.id, 'i').test(query))
}
export function routesFor(brief) {
  const loc = destination(brief.destination)
  const local = brief.origin.toLowerCase() === loc.name.toLowerCase()
  if (local) return [{name:'Explore locally',path:loc.name,price:0,hours:'Local travel',note:'Local transfers are included in the daily budget.'}]
  if (loc.id === 'singapore' && /hyderabad/i.test(brief.origin)) return [
    {name:'Direct flight',path:'Hyderabad → Singapore',price:22000,hours:'4.5 hr flight',note:'Shortest sample route. Fare estimate per traveler, one way.'},
    {name:'Flight + cruise',path:'Hyderabad → Kuala Lumpur → Port Klang → Singapore',price:24500,hours:'1–2 days',note:'Scenic sample route. Requires separate tickets and a matching sailing. Verify availability and entry requirements.'}
  ]
  if (loc.id === 'singapore') return [{name:'Flight',path:`${brief.origin} → Singapore`,price:26000,hours:'Varies by connection',note:'Illustrative one-way fare per traveler. Verify the actual connection.'}]
  return [
    {name:'Rail + local transfer',path:`${brief.origin} → ${loc.name}`,price:1700,hours:'Varies by service',note:'Sample cost per traveler, one way. Verify the nearest station and service.'},
    {name:'Flight + local transfer',path:`${brief.origin} → ${loc.name}`,price:5600,hours:'Varies by connection',note:'Sample cost per traveler, one way. Verify airport transfers and fares.'}
  ]
}
export function estimateLeg(a,b) {
  if (!a || !b) return 0
  const rad = value => value*Math.PI/180
  const dLat = rad(b.lat-a.lat)
  const dLon = rad(b.lon-a.lon)
  const hav = Math.sin(dLat/2)**2 + Math.cos(rad(a.lat))*Math.cos(rad(b.lat))*Math.sin(dLon/2)**2
  return Math.max(5,Math.round((6371*2*Math.asin(Math.sqrt(hav)))*1.28/23*60+4))
}
export function schedule(trip, index, legs=[]) {
  const loc = destination(trip.brief.destination)
  const day = trip.days[index]
  let cursor = day.relaxed ? 630 : 570
  let previous
  return day.stops.map((name, position) => {
    const item = loc.places.find(p=>p.name===name)
    const eta = legs[position-1] ?? estimateLeg(previous,item)
    const starts = cursor + eta
    cursor = starts + item.minutes + 20
    previous = item
    const range = /^(\d\d):(\d\d)–(\d\d):(\d\d)/.exec(item.hours)
    const hoursConflict = range && (starts < Number(range[1])*60+Number(range[2]) || (Number(range[3]) > 0 && starts+item.minutes > Number(range[3])*60+Number(range[4])))
    return {...item, starts, eta, hoursConflict}
  })
}
export function costs(trip, routeByDay={}) {
  const {people,days} = trip.brief
  const loc = destination(trip.brief.destination)
  const stay = loc.stays[trip.stay]
  const route = routesFor(trip.brief)[trip.route]
  const dailyPlans=trip.days.map((_,index)=>schedule(trip,index,routeByDay[index]))
  const activities = dailyPlans.flat()
  const values = {
    'Getting there':trip.agentRoute?.unpriced ? null : trip.agentTransport ?? route.price*people,
    'Accommodation':trip.sourcedStay ? null : stay.price*Math.max(0,days-1)*Math.ceil(people/2),
    'Food':(trip.agentFoodAllowance ?? (trip.agentTransport == null ? days*(loc.id==='singapore'?1250:650)*people : 0)) + activities.filter(p=>p.theme==='Food').reduce((sum,p)=>sum+p.price*people,0),
    'Activities':activities.filter(p=>p.theme!=='Food').reduce((sum,p)=>sum+p.price*people,0),
    'Local travel':trip.agentLocal ?? dailyPlans.reduce((total,plan)=>total+plan.reduce((sum,stop)=>sum+stop.eta*12,0)+300,0)
  }
  return {values,total:Object.values(values).reduce((sum,value)=>sum+value,0)}
}
