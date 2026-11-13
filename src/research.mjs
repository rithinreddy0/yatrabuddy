import {request} from './api.mjs'
import {researchPreferences} from './profile.mjs'

export const researchTopics=[['stays','bed','Stays'],['routes','plane','Routes'],['food','fork','Eats'],['experiences','sparkle','Experiences'],['events','calendar','Events']]

export function fetchResearch(place,{topic='overview',profile,trip,query,refresh=false,signal}={}){
  const preferences=researchPreferences(profile)
  if(place.id.startsWith('geo:')){
    const params=new URLSearchParams({topic})
    if(query)params.set('q',query)
    if(refresh)params.set('refresh','true')
    return request('locations/'+place.id.slice(4)+'/briefing?'+params,{signal})
  }
  return request('research',{method:'POST',body:{destination:place.id,topic,...preferences,departure:trip?.brief.date||null,days:trip?.brief.days||1,query,refresh},signal})
}
