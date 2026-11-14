import {draftSchedule} from './draftSchedule.mjs'

export function tripDate(departure, offset) {
  if (!departure) return ''
  return new Date(Date.parse(departure) + offset * 86_400_000).toISOString().slice(0, 10)
}

export function tripClock(now, timeZone) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone, year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', hourCycle:'h23',
  }).formatToParts(now).map(({type, value}) => [type, value]))
  return {date:`${parts.year}-${parts.month}-${parts.day}`, minute:Number(parts.hour) * 60 + Number(parts.minute)}
}

export function travelTimeline(draft, bookings, selectedDay) {
  const stops = draft.days.flatMap((_, index) => draftSchedule(draft, index).map(stop => ({
    ...stop, id:stop.place.url, title:stop.place.name, location:stop.place.address,
    day:index + Math.floor(stop.start / 1440), minute:stop.start % 1440,
    date:tripDate(draft.departure, index + Math.floor(stop.start / 1440)),
  })))
  const tickets = bookings.map(booking => {
    const [hour, minute] = (booking.time || '').split(':').map(Number)
    const day = booking.date && draft.departure ? (Date.parse(booking.date) - Date.parse(draft.departure)) / 86_400_000 : null
    return {...booking, booking:true, location:booking.place, day, minute:booking.time ? hour * 60 + minute : null}
  })
  return {
    events:[...stops, ...tickets].filter(event => event.day === selectedDay)
      .sort((a, b) => (a.minute ?? 1440) - (b.minute ?? 1440)),
    otherTickets:tickets.filter(ticket => ticket.day == null || ticket.day < 0 || ticket.day >= draft.days.length),
    reminders:[...stops, ...tickets].filter(event => event.date && event.minute != null),
    dayCount:Math.max(draft.days.length, ...stops.map(stop => stop.day + 1)),
  }
}
