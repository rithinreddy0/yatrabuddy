// A saved guest trip (Hyderabad → Mapusa, Goa) used to open trip screens without signing in.
// Built from a real planner run; place data is from Wikivoyage and OpenStreetMap.
const place = (name, category, source, url, lat, lon, address, description, fitScore = 60) => ({
  name, category, source, url, lat, lon, address, photo:null, description, website:null, openingHours:null,
  publishedPrice:null, rating:null, reviewCount:null, priceLevel:null, fitScore,
  fitReasons:[source === 'Wikivoyage' ? 'Listed in the Wikivoyage guide' : 'A nearby verified option from the available sources'],
})
const wv = page => 'https://en.wikivoyage.org/wiki/' + page

export const TRIP_ID = '8c53dc67-548e-4168-b0b2-1bd3c9c474a2'

export const trip = {
  id:TRIP_ID, cityId:1263580, name:'Mapusa', region:'Goa', country:'India', origin:'Hyderabad',
  stay:{...place('Hotel Satyaheera', 'Stay', 'OpenStreetMap', 'https://www.openstreetmap.org/node/1656639870', 15.5910323, 73.810367,
    'Hutatma Bann Desai Marg, Mapusa, Goa'), fitScore:null, fitReasons:[]},
  departure:'2026-12-11', travelers:2, party:null, budget:20000,
  days:[
    [place('Dr. Salim Ali Bird Sanctuary', 'Activity', 'Wikivoyage', wv('Panaji#Dr._Salim_Ali_Bird_Sanctuary'), 15.5146, 73.8575, 'Panaji', 'On the western tip of the island of Chorao, along River Mandovi.'),
      place('Chaatpata Chaat', 'Food', 'OpenStreetMap', 'https://www.openstreetmap.org/node/12174258389', 15.5912915, 73.8097923, 'Mapusa, Goa', undefined, 42),
      place('Mandovi River Sunset cruise', 'Activity', 'Wikivoyage', wv('Panaji#Mandovi_River_Sunset_cruise'), 15.5146, 73.8575, 'Panaji', 'A short boat ride on the river.')],
    [place('Goa State Museum', 'Sight', 'Wikivoyage', wv('Panaji#Goa_State_Museum'), 15.49294, 73.833255, 'Panaji', 'Hindu and Jain sculptures from the 4th to the 8th centuries.'),
      place('Eknath Snacks', 'Food', 'OpenStreetMap', 'https://www.openstreetmap.org/node/10973695738', 15.5911191, 73.8097528, 'Mapusa, Goa', undefined, 42),
      place('Miramar Beach', 'Nature', 'Wikivoyage', wv('Panaji#Miramar_Beach'), 15.482645, 73.807663, 'Panaji', 'Relax under a palm tree on Miramar beach.')],
    [place('Church of Lady of Rosary', 'Sight', 'Wikivoyage', wv('Old_Goa#Church_of_Lady_of_Rosary'), 15.50186, 73.90497, 'Old Goa', undefined, 57),
      place('Babaji Cafeteria', 'Food', 'OpenStreetMap', 'https://www.openstreetmap.org/node/1656637300', 15.5909807, 73.8100237, 'Mapusa, Goa', undefined, 42),
      place('Basilica of Bom Jesus', 'Sight', 'Wikivoyage', wv('Old_Goa#Basilica_of_Bom_Jesus'), 15.50091, 73.91158, 'Old Goa', 'Home to the grave of St. Francis Xavier.')],
  ],
  updated:1794676575099, mealPreference:'No preference', localModes:[], pace:'Balanced', mobility:null, transportPreference:null,
  interests:[], stayPreferences:[], notes:null,
  routes:[
    [{minutes:15, kilometres:11.1, method:'road'}, {minutes:28, kilometres:14.3, method:'road'}, {minutes:15, kilometres:11, method:'road'}],
    [{minutes:15, kilometres:12.5, method:'road'}, {minutes:15, kilometres:12.9, method:'road'}, {minutes:18, kilometres:16.5, method:'road'}],
    [{minutes:25, kilometres:19.7, method:'road'}, {minutes:26, kilometres:23, method:'road'}, {minutes:24, kilometres:21.6, method:'road'}],
  ],
  routeGeometry:[], routeAdvice:null, stopCosts:{}, weather:[], weatherStatus:'not_requested', weatherNote:null,
  ledger:{categoryBudgets:{Transport:5000, Stay:6000, Food:3000}, contingency:2000, members:['Asha', 'Ravi'], expenses:[
    {id:'3ae4d466-7c00-4a0b-bb4f-e1482ed7f0fc', kind:'expense', category:'Stay', amount:5000, date:'2026-11-14', note:'Hotel two nights', payer:'Ravi', split:[], bookingId:null},
    {id:'2bdb7945-e61e-4616-ac84-9e87a181a92e', kind:'expense', category:'Food', amount:1200, date:'2026-11-14', note:'Dinner at Mapusa market', payer:'Asha', split:[], bookingId:null},
  ]},
  journey:{
    home:{name:'Hyderabad', lat:17.38405, lon:78.45636},
    outbound:{mode:'train', date:'2026-12-10', departTime:'17:40', arriveTime:'08:50', arriveNextDay:true, service:'Sample train', estimatedCost:2400,
      bookingId:null, notes:'', fromHub:{name:'Hyderabad Deccan Nampally', code:'HYB', lat:17.3924223, lon:78.4675956},
      toHub:{name:'Thivim', code:'THVM', lat:15.6298781, lon:73.8770455}, firstTransfer:{kilometres:2.7, minutes:5}, lastTransfer:{kilometres:9.9, minutes:11}},
    returnLeg:{mode:'train', date:'2026-12-13', departTime:'22:10', arriveTime:'13:40', arriveNextDay:true, service:'', estimatedCost:2400,
      bookingId:null, notes:'', fromHub:{name:'Thivim', code:'THVM', lat:15.6298781, lon:73.8770455},
      toHub:{name:'Hyderabad Deccan Nampally', code:'HYB', lat:17.3924223, lon:78.4675956}, firstTransfer:{kilometres:9.7, minutes:10}, lastTransfer:{kilometres:3.5, minutes:6}},
  },
}

export const guestLibrary = {trips:[], drafts:[trip], saved:[], style:'', profile:null, sampleExpenses:[]}

/** Seed the guest library before the app boots. */
export async function seedGuest(page) {
  await page.addInitScript(library => {
    if (!sessionStorage.getItem('seeded')) {
      localStorage.setItem('wayfarer.guest.v2', JSON.stringify(library))
      sessionStorage.setItem('seeded', '1')
    }
  }, guestLibrary)
}
