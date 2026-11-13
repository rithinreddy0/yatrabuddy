import React,{useState} from 'react'
import {Icon} from './UI.jsx'

function https(value){
  try{return new URL(value).protocol==='https:'?value:null}catch{return null}
}

export function PlacePhoto({place,hideUnavailable=false,onUnavailable}){
  const photo=place.photo
  const urls=[...new Set([https(photo?.url),https(photo?.originalUrl)].filter(Boolean))]
  const [failedUrl,setFailedUrl]=useState(null)
  const [failedOriginal,setFailedOriginal]=useState(null)
  const url=urls.find(candidate=>candidate!==failedUrl&&candidate!==failedOriginal)
  const hasPhoto=Boolean(url)
  const source=https(photo?.sourceUrl)
  if(hideUnavailable&&!hasPhoto&&!source)return null
  const license=https(photo?.licenseUrl)
  const map = Number.isFinite(place.lat) && Number.isFinite(place.lon)
    ? `https://www.openstreetmap.org/?mlat=${place.lat}&mlon=${place.lon}#map=17/${place.lat}/${place.lon}` : null
  function imageFailed() {
    if (urls[0]===url) setFailedUrl(url)
    else setFailedOriginal(url)
    if (!urls.some(candidate=>candidate!==url&&candidate!==failedUrl&&candidate!==failedOriginal)) onUnavailable?.()
  }
  return <figure className={'place-photo'+(!hasPhoto&&hideUnavailable?' place-photo-source-only':'')}>
    {hasPhoto?<><img src={url} alt={photo.kind==='nearby'?`Around ${place.name}`:place.name} loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={imageFailed}/>
      <figcaption>{photo.kind==='nearby'&&'Nearby photo · '}{photo.credit}{photo.authors?.map((author,index)=><span key={index}>{https(author.url)?<a href={author.url} target="_blank" rel="noreferrer">{author.name}</a>:author.name} · </span>)}{source&&<>{photo.credit&&' · '}<a href={source} target="_blank" rel="noreferrer">{photo.authors?'Photo on Google Maps':'Photo source'}</a></>}
        {photo.license&&<> · {license?<a href={license} target="_blank" rel="noreferrer">{photo.license}</a>:photo.license}</>}
      </figcaption></>:<>
      {source?<figcaption><a href={source} target="_blank" rel="noreferrer">Open original photo</a></figcaption>
        :!hideUnavailable&&map&&<figcaption><a className="place-photo-map-link" href={map} target="_blank" rel="noreferrer"><Icon name="pin" size={14}/> Open location on map</a></figcaption>}
    </>}
  </figure>
}
