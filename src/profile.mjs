export const preferences={
  styles:['Balanced','Nature','Culture','Food','Adventure','Relaxed'],
  interests:['Nature','Culture','Food','Adventure','Relaxation','Shopping','Arts & design','Nightlife'],
  groups:['Any','Solo','Couple','Friends','Family'],
  stays:['Hotels','Boutique stays','Resorts','Vacation rentals','Hostels','Homestays'],
  diets:['No restrictions','Vegetarian','Vegan','Jain','Halal'],
  paces:['Relaxed','Balanced','Packed'],
  transport:['Any','Public transit','Car','Bike','Walking'],
  mobility:['No preference','Less walking','Step-free when possible'],
}
export const defaultProfile={
  preferredName:'',homeCity:'',travelGroup:'Any',travelers:2,tripDays:3,budget:25000,style:'Balanced',
  interests:[],stayPreferences:[],diet:'No restrictions',pace:'Balanced',transport:'Any',mobility:'No preference',notes:'',
}
const researchInterests=['Nature','Culture','Food','Adventure']
export function preferredDestination(library,catalog) {
  const latest=[...library.trips].sort((a,b)=>b.updated-a.updated)[0]?.brief.destination
  if(latest&&catalog.some(item=>item.id===latest))return latest
  return catalog.find(item=>library.saved.includes(item.id))?.id || personalizedPlaces(catalog,library)[0]?.id
}
export function personalizedPlaces(catalog,library) {
  const profile=library.profile
  const style=profile?.style||library.style
  const month=new Date().getMonth()+1
  const score=item=>{
    const styleMatch=item.theme===style?4:0
    const interest=profile?.interests.includes(item.theme)?3:0
    const budgetFit=profile&&item.stays[0].price*Math.ceil(profile.travelers/2)*Math.max(0,profile.tripDays-1)<=profile.budget*.55?2:0
    const seasonal=item.id==='kutch'&&[11,12,1,2].includes(month)?3:0
    return styleMatch+interest+budgetFit+seasonal+(library.saved.includes(item.id)?1:0)
  }
  return [...catalog].sort((a,b)=>score(b)-score(a))
}
export function researchPreferences(profile) {
  if(!profile)return {}
  const interest=researchInterests.includes(profile.style)?profile.style:profile.interests.find(item=>researchInterests.includes(item))||null
  return {interest,diet:profile.diet}
}
