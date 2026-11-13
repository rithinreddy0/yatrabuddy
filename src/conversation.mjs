import {request} from './api.mjs'
import {researchPreferences} from './profile.mjs'

export function askTravel(message,{history=[],destination,placeQuery,profile,signal}={}){
  return request('conversation',{method:'POST',body:{
    message,history:history.slice(-8).map(turn=>({role:turn.role,content:turn.content.slice(0,1200)})),
    destination:destination?.id||null,placeQuery:placeQuery||null,...researchPreferences(profile),
  },signal})
}
